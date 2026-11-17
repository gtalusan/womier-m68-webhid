#!/usr/bin/env python3
"""Probe the Womier M68 HE (0416:7372) HID device on macOS via IOKit C API (ctypes).

- Enumerates all HID collections for the device
- Dumps + lightly parses each collection's HID report descriptor
- Attempts the handshake (output report ID 1 / 6, wire cmd 0x0D) via
  IOHIDDeviceSetReport and catches interrupt-IN responses via callback.
"""
import ctypes
import ctypes.util
import struct
import sys
import time

from ctypes import (c_void_p, c_int, c_uint32, c_uint8, c_uint64, c_size_t,
                    c_char_p, POINTER, byref, CFUNCTYPE, cast)

IOKit = ctypes.CDLL(ctypes.util.find_library("IOKit"))
CoreFoundation = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))

# --- CF helpers ---------------------------------------------------------
CFAllocatorRef = c_void_p
CFTypeRef = c_void_p
CFStringRef = c_void_p
CFDataRef = c_void_p
CFSetRef = c_void_p
CFRunLoopRef = c_void_p
CFDictionaryRef = c_void_p

CoreFoundation.CFStringCreateWithCString.restype = CFStringRef
CoreFoundation.CFStringCreateWithCString.argtypes = [CFAllocatorRef, c_char_p, c_uint32]
CoreFoundation.CFDataGetBytePtr.restype = POINTER(c_uint8)
CoreFoundation.CFDataGetBytePtr.argtypes = [CFDataRef]
CoreFoundation.CFDataGetLength.restype = c_size_t
CoreFoundation.CFDataGetLength.argtypes = [CFDataRef]
CoreFoundation.CFGetTypeID.restype = c_uint64
CoreFoundation.CFGetTypeID.argtypes = [CFTypeRef]
CoreFoundation.CFDictionaryCreateMutable.restype = CFDictionaryRef
CoreFoundation.CFDictionaryCreateMutable.argtypes = [CFAllocatorRef, c_size_t, c_void_p, c_void_p]
CoreFoundation.CFDictionarySetValue.argtypes = [CFDictionaryRef, c_void_p, c_void_p]
CoreFoundation.CFDictionarySetValue.restype = None
CoreFoundation.CFNumberCreate.restype = c_void_p
CoreFoundation.CFNumberCreate.argtypes = [CFAllocatorRef, c_int, c_void_p]
CoreFoundation.CFRunLoopRunInMode.restype = c_int
CoreFoundation.CFRunLoopRunInMode.argtypes = [CFStringRef, ctypes.c_double, c_uint8]
CoreFoundation.CFDataCreate.restype = CFDataRef
CoreFoundation.CFDataCreate.argtypes = [CFAllocatorRef, c_void_p, c_size_t]

def cfstr(s: str) -> CFStringRef:
    return CoreFoundation.CFStringCreateWithCString(None, s.encode(), 0x08000100)  # kCFStringEncodingUTF8

def cfnum(i: int) -> c_void_p:
    v = c_uint32(i)
    return CoreFoundation.CFNumberCreate(None, 9, byref(v))  # kCFNumberSInt32Type

# --- IOHIDManager (C API in IOKit) --------------------------------------
kIOHIDOptionsTypeSeizeDevice = 1
kIOHIDReportTypeInput = 0
kIOHIDReportTypeOutput = 1
kIOHIDReportTypeFeature = 2

IOKit.IOHIDManagerCreate.restype = c_void_p
IOKit.IOHIDManagerCreate.argtypes = [CFAllocatorRef, c_int]
IOKit.IOHIDManagerSetDeviceMatching.restype = None
IOKit.IOHIDManagerSetDeviceMatching.argtypes = [c_void_p, CFDictionaryRef]
IOKit.IOHIDManagerCopyDevices.restype = CFSetRef
IOKit.IOHIDManagerCopyDevices.argtypes = [c_void_p]
IOKit.IOHIDDeviceGetProperty.restype = CFTypeRef
IOKit.IOHIDDeviceGetProperty.argtypes = [c_void_p, CFStringRef]
IOKit.IOHIDDeviceOpen.restype = c_int  # IOReturn
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
CoreFoundation.CFRunLoopGetCurrent.restype = CFRunLoopRef
CoreFoundation.CFSetGetCount.restype = c_size_t
CoreFoundation.CFSetGetCount.argtypes = [CFSetRef]
CoreFoundation.CFSetGetValues.restype = None
CoreFoundation.CFSetGetValues.argtypes = [CFSetRef, c_void_p]

VENDOR_ID, PRODUCT_ID = 0x0416, 0x7372

received = []
InputReportCallback = CFUNCTYPE(None, c_void_p, c_int, c_int, c_int, CFDataRef, c_void_p)
def on_input_report(context, result, sender, report_type, report_id, report, length):
    if report is not None:
        n = CoreFoundation.CFDataGetLength(report)
        p = CoreFoundation.CFDataGetBytePtr(report)
        data = bytes(p[i] for i in range(n))
        received.append((report_id, data))
cb = InputReportCallback(on_input_report)

# --- HID report descriptor mini-parser ----------------------------------
def parse_report_descriptor(d: bytes):
    """Return list of collections: [{usage_page, usage, reports: [(kind, report_id, bits)]}]"""
    cols = []
    cur = None
    stack = []
    usage_page = 0
    usage = 0
    report_id = 0
    count = 0
    size = 0
    kind = None
    local_usage_stack = []

    i = 0
    def item(tag, val):
        nonlocal cur
        return None
    while i < len(d):
        b = d[i]
        if b == 0xFE:  # long item
            bsize, btag = d[i+1], d[i+2]
            i += 3 + bsize
            continue
        tag = b >> 4
        ptype = (b >> 2) & 0x03
        size_code = b & 0x03
        if size_code == 3:
            size_code = 4
        if size_code == 0:
            val = 0
        elif size_code == 1:
            val = d[i+1]
        elif size_code == 2:
            val = d[i+1] | (d[i+2] << 8)
        else:
            val = d[i+1] | (d[i+2] << 8) | (d[i+3] << 16) | (d[i+4] << 24)
        i += 1 + size_code
        # global items (ptype 1), main (0), local (2)
        if ptype == 1:
            if tag == 0: usage_page = val
            elif tag == 1:
                # logical min
                pass
            elif tag == 8:  # report size
                size = val
            elif tag == 9:  # report count
                count = val
            elif tag == 7:  # report id
                report_id = val
        elif ptype == 0:  # main items
            if tag == 10:  # collection
                cur = {"usage_page": usage_page, "usage": usage, "reports": []}
                cols.append(cur)
                stack.append(cur)
            elif tag == 12:  # end collection
                if stack: stack.pop()
                cur = stack[-1] if stack else None
            elif tag in (8, 9, 11):  # input/output/feature
                k = {8: "input", 9: "output", 11: "feature"}[tag]
                if cur is not None and count and size:
                    cur["reports"].append((k, report_id, count * size))
                count = size = 0
        elif ptype == 2:  # local items
            if tag == 0 and val: usage = val
    return cols

def fmt_desc(d: bytes):
    out = []
    for c in parse_report_descriptor(d):
        out.append(f"  collection usage_page=0x{c['usage_page']:04X} usage=0x{c['usage']:02X}")
        for k, rid, bits in c["reports"]:
            out.append(f"    {k:8s} reportID=0x{rid:02X} size={bits//8} bytes")
    return "\n".join(out)

# --- main ---------------------------------------------------------------
manager = IOKit.IOHIDManagerCreate(None, 0)
match = CoreFoundation.CFDictionaryCreateMutable(None, 0, None, None)
CoreFoundation.CFDictionarySetValue(match, cfstr("VendorID"), cfnum(VENDOR_ID))
CoreFoundation.CFDictionarySetValue(match, cfstr("ProductID"), cfnum(PRODUCT_ID))
IOKit.IOHIDManagerSetDeviceMatching(manager, match)
device_set = IOKit.IOHIDManagerCopyDevices(manager)
n = CoreFoundation.CFSetGetCount(device_set)
print(f"found {n} IOHIDDevice(s) for {VENDOR_ID:04X}:{PRODUCT_ID:04X}")

devices = (c_void_p * n)()
CoreFoundation.CFSetGetValues(device_set, devices)

def prop(dev, key, want_int=False):
    p = IOKit.IOHIDDeviceGetProperty(dev, cfstr(key))
    if not p:
        return None
    # could be CFNumber or CFString
    return p

for idx in range(n):
    dev = devices[idx]
    print(f"\n===== device {idx} =====")
    for key in ("Product", "Manufacturer", "SerialNumber", "Transport", "PrimaryUsagePage", "PrimaryUsage", "VendorID", "ProductID", "LocationID"):
        p = prop(dev, key)
        if p:
            if key in ("PrimaryUsagePage", "PrimaryUsage", "VendorID", "ProductID", "LocationID"):
                # CFNumber: try to read via ctypes int at the pointer (kCFNumberSInt32)
                try:
                    v = ctypes.cast(p, POINTER(c_int))[0] if False else None
                except Exception:
                    v = None
                # simpler: use CFNumberGetValue
                CFNumberGetValue = CoreFoundation.CFNumberGetValue
                CFNumberGetValue.restype = c_uint8
                CFNumberGetValue.argtypes = [c_void_p, c_int, c_void_p]
                buf = c_uint32()
                if CFNumberGetValue(p, 9, byref(buf)):  # kCFNumberSInt32Type = 9
                    print(f"  {key}: {buf.value}")
                else:
                    print(f"  {key}: (unreadable)")
            else:
                # CFString: borrow via CFStringGetCStringPtr (fast path) — assume inline
                CoreFoundation.CFStringGetCStringPtr.restype = c_char_p
                CoreFoundation.CFStringGetCStringPtr.argtypes = [c_void_p, c_uint32]
                s = CoreFoundation.CFStringGetCStringPtr(p, 0x08000100)
                if s:
                    print(f"  {key}: {s.decode(errors='replace')}")
                else:
                    print(f"  {key}: (cfstring, non-inline)")
    rd = prop(dev, "ReportDescriptor")
    if rd:
        ln = CoreFoundation.CFDataGetLength(rd)
        bp = CoreFoundation.CFDataGetBytePtr(rd)
        raw = bytes(bp[i] for i in range(ln))
        print(f"  ReportDescriptor ({ln} bytes):")
        print(fmt_desc(raw))
        print("  hex: " + raw.hex())

    # handshake test on this collection
    print(f"  -- handshake test (SetReport output, IDs 1 and 6) --")
    rc = IOKit.IOHIDDeviceOpen(dev, kIOHIDOptionsTypeSeizeDevice)
    print(f"  IOHIDDeviceOpen(seize) -> {rc:#x}")
    if rc == 0:
        IOKit.IOHIDDeviceRegisterInputReportCallback(dev, cb, None)
        IOKit.IOHIDDeviceScheduleWithRunLoop(dev, CoreFoundation.CFRunLoopGetCurrent(), cfstr("kCFRunLoopDefaultMode"))
        for rid in (1, 6):
            received.clear()
            # vendor report = 63 data bytes + report ID argument
            frame = bytes([0x0D]) + bytes(62)
            rc = IOKit.IOHIDDeviceSetReport(dev, kIOHIDReportTypeOutput, rid, frame, len(frame))
            print(f"  SetReport(output, reportID={rid}, cmd=0x0D, {len(frame)}B) -> {rc:#x}")
            t0 = time.time()
            while time.time() - t0 < 2.0 and not received:
                CoreFoundation.CFRunLoopRunInMode(cfstr("kCFRunLoopDefaultMode"), 0.05, 1)
            if received:
                for rrid, data in received[:3]:
                    print(f"    INPUT REPORT (id={rrid}) {len(data)}B: {data[:32].hex()}  ascii: {bytes(b if 32<=b<127 else 46 for b in data[:48]).decode()}")
            else:
                print("    (no input report received within 1.2s — trying GetReport)")
                buf = (c_uint8 * 64)()
                buflen = c_size_t(64)
                rc = IOKit.IOHIDDeviceGetReport(dev, kIOHIDReportTypeInput, rid, buf, byref(buflen))
                print(f"    GetReport(input, reportID={rid}) -> {rc:#x} len={buflen.value} data={bytes(buf[:buflen.value])[:16].hex() if rc==0 else ''}")
        IOKit.IOHIDDeviceClose(dev)
