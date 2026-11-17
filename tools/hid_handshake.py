#!/usr/bin/env python3
"""Focused handshake probe for the M68 HE vendor collection (0xFF1B/0x91).

Targets the vendor top-level collection deterministically, tries
IOHIDDeviceOpen (plain + seize) with retries, sends the 0x0D handshake
via IOHIDDeviceSetReport(output, reportID=1), listens for interrupt-IN
reports, then tries GetReport. Prints all return codes and hex data.
"""
import ctypes
import ctypes.util
import struct
import sys
import time

from ctypes import (c_void_p, c_int, c_uint32, c_uint8, c_uint64, c_size_t,
                    c_char_p, c_double, POINTER, byref, CFUNCTYPE, cast)

IOKit = ctypes.CDLL(ctypes.util.find_library("IOKit"))
CF = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))

# --- CF ---
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

def cfstr(s):
    return CF.CFStringCreateWithCString(None, s.encode(), 0x08000100)

def cfnum(i):
    v = c_uint32(i)
    return CF.CFNumberCreate(None, 9, byref(v))

# --- IOKit HID ---
kIOHIDOptionsTypeNone = 0
kIOHIDOptionsTypeSeizeDevice = 1
kIOHIDReportTypeInput = 0
kIOHIDReportTypeOutput = 1

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

VENDOR_ID, PRODUCT_ID = 0x0416, 0x7372
received = []
InputReportCallback = CFUNCTYPE(None, c_void_p, c_int, c_int, c_int, CFDataRef, c_void_p)
def on_input(context, result, sender, rtype, rid, report, length):
    if report is not None:
        n = CF.CFDataGetLength(report)
        p = CF.CFDataGetBytePtr(report)
        received.append((rid, bytes(p[i] for i in range(n))))
        print(f"  << input report id={rid} len={n}: {received[-1][1][:64].hex()}")
cb = InputReportCallback(on_input)

def prop_int(dev, key):
    p = IOKit.IOHIDDeviceGetProperty(dev, cfstr(key))
    if not p:
        return None
    buf = c_uint32()
    if CF.CFNumberGetValue(p, 9, byref(buf)):
        return buf.value
    return None

def errname(rc):
    names = {0: "kIOReturnSuccess", -536870201: "kIOReturnError(0xE00002C7)",
             -536870203: "kIOReturnExclusiveAccess(0xE00002C5)",
             -536870193: "kIOReturnNotOpen(0xE00002CF)"}
    if rc in names:
        return names[rc]
    return f"{rc:#x}"

# --- enumerate ---
manager = IOKit.IOHIDManagerCreate(None, 0)
match = CF.CFDictionaryCreateMutable(None, 0, None, None)
CF.CFDictionarySetValue(match, cfstr("VendorID"), cfnum(VENDOR_ID))
CF.CFDictionarySetValue(match, cfstr("ProductID"), cfnum(PRODUCT_ID))
IOKit.IOHIDManagerSetDeviceMatching(manager, match)
device_set = IOKit.IOHIDManagerCopyDevices(manager)
n = CF.CFSetGetCount(device_set)
print(f"found {n} devices")
devices = (c_void_p * n)()
CF.CFSetGetValues(device_set, devices)

vendor_dev = None
for i in range(n):
    d = devices[i]
    up = prop_int(d, "PrimaryUsagePage")
    u = prop_int(d, "PrimaryUsage")
    loc = prop_int(d, "LocationID")
    print(f"dev[{i}] usage_page={up:#06x} usage={u:#04x} loc={loc:#x}")
    if up == 65307 and u == 145:
        vendor_dev = d

if vendor_dev is None:
    print("!! vendor collection not found")
    sys.exit(1)

print(f"\ntarget: vendor collection ({vendor_dev})")
# open with retries, plain then seize
opened = None
for attempt in range(4):
    rc = IOKit.IOHIDDeviceOpen(vendor_dev, kIOHIDOptionsTypeNone)
    print(f"open attempt {attempt} (plain) -> {errname(rc)}")
    if rc == 0:
        opened = "plain"
        break
    time.sleep(0.5)
if opened is None:
    for attempt in range(4):
        rc = IOKit.IOHIDDeviceOpen(vendor_dev, kIOHIDOptionsTypeSeizeDevice)
        print(f"open attempt {attempt} (seize) -> {errname(rc)}")
        if rc == 0:
            opened = "seize"
            break
        time.sleep(0.5)
if opened is None:
    print("!! could not open vendor device — maybe keyboard asleep; press a key and retry")
    sys.exit(1)
print(f"opened ({opened})")

IOKit.IOHIDDeviceRegisterInputReportCallback(vendor_dev, cb, None)
IOKit.IOHIDDeviceScheduleWithRunLoop(vendor_dev, CF.CFRunLoopGetCurrent(), cfstr("kCFRunLoopDefaultMode"))

def send_and_listen(cmd, report_id, wait=2.5):
    received.clear()
    frame = bytes([cmd]) + bytes(62)
    rc = IOKit.IOHIDDeviceSetReport(vendor_dev, kIOHIDReportTypeOutput, report_id, frame, len(frame))
    print(f"SetReport(output, rid={report_id}, cmd={cmd:#04x}, 63B) -> {errname(rc)}")
    t0 = time.time()
    while time.time() - t0 < wait:
        CF.CFRunLoopRunInMode(cfstr("kCFRunLoopDefaultMode"), 0.05, 1)
        if received:
            break
    if not received:
        print("  (no interrupt-IN within wait; trying GetReport)")
        buf = (c_uint8 * 64)()
        buflen = c_size_t(64)
        rc = IOKit.IOHIDDeviceGetReport(vendor_dev, kIOHIDReportTypeInput, report_id, buf, byref(buflen))
        print(f"  GetReport(input, rid={report_id}) -> {errname(rc)} len={buflen.value}")
        if rc == 0 and buflen.value:
            print(f"  data: {bytes(buf[:buflen.value]).hex()}")

print("\n-- handshake: wire cmd 0x0D (device info), rid=1 --")
send_and_listen(0x0D, 1)
print("\n-- SN query: wire cmd 0x15, rid=1 --")
send_and_listen(0x15, 1)
print("\n-- handshake again, rid=1 --")
send_and_listen(0x0D, 1)

IOKit.IOHIDDeviceClose(vendor_dev)
print("done")
