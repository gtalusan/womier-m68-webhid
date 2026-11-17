#!/usr/bin/env python3
"""Variant matrix: which SET_REPORT frame layout (if any) the firmware accepts.

Tries on the vendor collection (0xFF1B/0x91), listening for interrupt-IN
responses after each write:
  A: rid=1, 63B [0D,0..]
  B: rid=1, 64B [01,0D,0..]  (ID byte inside buffer)
  C: rid=0, 64B [01,0D,0..]
  D: rid=1, 63B [01,0D,..]   (ID byte as first data byte, 63 total)
"""
import ctypes, ctypes.util, sys, time
from ctypes import (c_void_p, c_int, c_uint32, c_uint8, c_size_t, c_char_p,
                    c_double, POINTER, byref, CFUNCTYPE)

IOKit = ctypes.CDLL(ctypes.util.find_library("IOKit"))
CF = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))
CFAllocatorRef = c_void_p
CFStringRef = c_void_p
CFDataRef = c_void_p
CFSetRef = c_void_p
CFRunLoopRef = c_void_p
CFDictionaryRef = c_void_p
CF.CFStringCreateWithCString.restype = CFStringRef
CF.CFStringCreateWithCString.argtypes = [CFAllocatorRef, c_char_p, c_uint32]
CF.CFDataGetBytePtr.restype = POINTER(c_uint8)
CF.CFDataGetBytePtr.argtypes = [CFDataRef]
CF.CFDataGetLength.restype = c_size_t
CF.CFDataGetLength.argtypes = [CFDataRef]
CF.CFDictionaryCreateMutable.restype = CFDictionaryRef
CF.CFDictionaryCreateMutable.argtypes = [CFAllocatorRef, c_size_t, c_void_p, c_void_p]
CF.CFDictionarySetValue.restype = None
CF.CFDictionarySetValue.argtypes = [CFDictionaryRef, c_void_p, c_void_p]
CF.CFNumberCreate.restype = c_void_p
CF.CFNumberCreate.argtypes = [CFAllocatorRef, c_int, c_void_p]
CF.CFRunLoopRunInMode.restype = c_int
CF.CFRunLoopRunInMode.argtypes = [CFStringRef, c_double, c_uint8]
CF.CFRunLoopGetCurrent.restype = CFRunLoopRef
CF.CFSetGetCount.restype = c_size_t
CF.CFSetGetCount.argtypes = [CFSetRef]
CF.CFSetGetValues.restype = None
CF.CFSetGetValues.argtypes = [CFSetRef, c_void_p]
CF.CFNumberGetValue.restype = c_uint8
CF.CFNumberGetValue.argtypes = [c_void_p, c_int, c_void_p]
def cfstr(s): return CF.CFStringCreateWithCString(None, s.encode(), 0x08000100)
def cfnum(i):
    v = c_uint32(i); return CF.CFNumberCreate(None, 9, byref(v))

IOKit.IOHIDManagerCreate.restype = c_void_p
IOKit.IOHIDManagerCreate.argtypes = [CFAllocatorRef, c_int]
IOKit.IOHIDManagerSetDeviceMatching.restype = None
IOKit.IOHIDManagerSetDeviceMatching.argtypes = [c_void_p, CFDictionaryRef]
IOKit.IOHIDManagerCopyDevices.restype = CFSetRef
IOKit.IOHIDManagerCopyDevices.argtypes = [c_void_p]
IOKit.IOHIDDeviceGetProperty.restype = c_void_p
IOKit.IOHIDDeviceGetProperty.argtypes = [c_void_p, CFStringRef]
IOKit.IOHIDDeviceOpen.restype = c_int
IOKit.IOHIDDeviceOpen.argtypes = [c_void_p, c_uint32]
IOKit.IOHIDDeviceClose.restype = c_int
IOKit.IOHIDDeviceClose.argtypes = [c_void_p]
IOKit.IOHIDDeviceSetReport.restype = c_int
IOKit.IOHIDDeviceSetReport.argtypes = [c_void_p, c_int, c_int, c_void_p, c_size_t]
IOKit.IOHIDDeviceGetReport.restype = c_int
IOKit.IOHIDDeviceGetReport.argtypes = [c_void_p, c_int, c_int, c_void_p, POINTER(c_size_t)]
IOKit.IOHIDDeviceRegisterInputReportCallback.restype = None
IOKit.IOHIDDeviceRegisterInputReportCallback.argtypes = [c_void_p, c_void_p, c_void_p]
IOKit.IOHIDDeviceScheduleWithRunLoop.restype = None
IOKit.IOHIDDeviceScheduleWithRunLoop.argtypes = [c_void_p, CFRunLoopRef, CFStringRef]

received = []
InputReportCallback = CFUNCTYPE(None, c_void_p, c_int, c_int, c_int, CFDataRef, c_void_p)
def on_input(context, result, sender, rtype, rid, report, length):
    if report is not None:
        n = CF.CFDataGetLength(report)
        p = CF.CFDataGetBytePtr(report)
        received.append((rid, bytes(p[i] for i in range(n))))
cb = InputReportCallback(on_input)

def prop_int(dev, key):
    p = IOKit.IOHIDDeviceGetProperty(dev, cfstr(key))
    if not p: return None
    buf = c_uint32()
    if CF.CFNumberGetValue(p, 9, byref(buf)): return buf.value
    return None

manager = IOKit.IOHIDManagerCreate(None, 0)
match = CF.CFDictionaryCreateMutable(None, 0, None, None)
CF.CFDictionarySetValue(match, cfstr("VendorID"), cfnum(0x0416))
CF.CFDictionarySetValue(match, cfstr("ProductID"), cfnum(0x7372))
IOKit.IOHIDManagerSetDeviceMatching(manager, match)
s = IOKit.IOHIDManagerCopyDevices(manager)
n = CF.CFSetGetCount(s)
devices = (c_void_p * n)()
CF.CFSetGetValues(s, devices)
vendor = None
for i in range(n):
    if prop_int(devices[i], "PrimaryUsagePage") == 65307:
        vendor = devices[i]
print("vendor device found:", vendor is not None)
rc = IOKit.IOHIDDeviceOpen(vendor, 1)
print("open(seize):", hex(rc & 0xFFFFFFFF))
IOKit.IOHIDDeviceRegisterInputReportCallback(vendor, cb, None)
IOKit.IOHIDDeviceScheduleWithRunLoop(vendor, CF.CFRunLoopGetCurrent(), cfstr("kCFRunLoopDefaultMode"))

def try_write(label, rid, frame, wait=2.0):
    received.clear()
    rc = IOKit.IOHIDDeviceSetReport(vendor, 1, rid, frame, len(frame))
    print(f"{label}: SetReport(out, rid={rid}, {len(frame)}B [{frame[:4].hex()}...]) -> {rc & 0xFFFFFFFF:#x}")
    t0 = time.time()
    while time.time() - t0 < wait:
        CF.CFRunLoopRunInMode(cfstr("kCFRunLoopDefaultMode"), 0.05, 1)
        if received: break
    if received:
        for rid2, data in received[:2]:
            print(f"   << IN id={rid2} {len(data)}B: {data[:40].hex()}")
            print(f"      ascii: {bytes(b if 32<=b<127 else 46 for b in data[:48]).decode()}")
    else:
        buf = (c_uint8 * 64)()
        bl = c_size_t(64)
        rc = IOKit.IOHIDDeviceGetReport(vendor, 0, rid, buf, byref(bl))
        print(f"   GetReport(in, rid={rid}) -> {rc & 0xFFFFFFFF:#x} len={bl.value} data={bytes(buf[:bl.value]).hex() if bl.value else ''}")

try_write("A: rid=1 63B data=[0D..]  ", 1, bytes([0x0D]) + bytes(62))
try_write("B: rid=1 64B data=[01,0D..]", 1, bytes([0x01, 0x0D]) + bytes(62))
try_write("C: rid=0 64B data=[01,0D..]", 0, bytes([0x01, 0x0D]) + bytes(62))
try_write("D: rid=1 63B data=[01,0D..]", 1, bytes([0x01, 0x0D]) + bytes(61))
IOKit.IOHIDDeviceClose(vendor)
print("done")
