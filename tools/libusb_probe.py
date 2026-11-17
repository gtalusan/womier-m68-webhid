#!/usr/bin/env python3
"""libusb probe for the M68 HE (0416:7372) on macOS.

- Enumerates the device, dumps interface/endpoint layout
- Tries claiming each interface
- On the vendor interface: interrupt-OUT handshake (report [1,0x0D,0..])
  then interrupt-IN read.
"""
import ctypes
import ctypes.util
import time

lib = ctypes.CDLL("/opt/homebrew/lib/libusb-1.0.dylib")

# types
class DeviceDescriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8), ("bDescriptorType", ctypes.c_uint8),
        ("bcdUSB", ctypes.c_uint16), ("bDeviceClass", ctypes.c_uint8),
        ("bDeviceSubClass", ctypes.c_uint8), ("bDeviceProtocol", ctypes.c_uint8),
        ("bMaxPacketSize0", ctypes.c_uint8), ("idVendor", ctypes.c_uint16),
        ("idProduct", ctypes.c_uint16), ("bcdDevice", ctypes.c_uint16),
        ("iManufacturer", ctypes.c_uint8), ("iProduct", ctypes.c_uint8),
        ("iSerialNumber", ctypes.c_uint8), ("bNumConfigurations", ctypes.c_uint8),
    ]

class EndpointDescriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8), ("bDescriptorType", ctypes.c_uint8),
        ("bEndpointAddress", ctypes.c_uint8), ("bmAttributes", ctypes.c_uint8),
        ("wMaxPacketSize", ctypes.c_uint16), ("bInterval", ctypes.c_uint8),
        ("bRefresh", ctypes.c_uint8), ("bSynchAddress", ctypes.c_uint8),
        ("extra", ctypes.c_void_p), ("extra_length", ctypes.c_int),
    ]

class InterfaceDescriptor(ctypes.Structure):
    pass
InterfaceDescriptor._fields_ = [
    ("bLength", ctypes.c_uint8), ("bDescriptorType", ctypes.c_uint8),
    ("bInterfaceNumber", ctypes.c_uint8), ("bAlternateSetting", ctypes.c_uint8),
    ("bNumEndpoints", ctypes.c_uint8), ("bInterfaceClass", ctypes.c_uint8),
    ("bInterfaceSubClass", ctypes.c_uint8), ("bInterfaceProtocol", ctypes.c_uint8),
    ("iInterface", ctypes.c_uint8),
    ("endpoint", ctypes.POINTER(EndpointDescriptor)),
    ("extra", ctypes.c_void_p), ("extra_length", ctypes.c_int),
]

class Interface(ctypes.Structure):
    _fields_ = [
        ("altsetting", ctypes.POINTER(InterfaceDescriptor)),
        ("num_altsetting", ctypes.c_int),
    ]

class ConfigDescriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8), ("bDescriptorType", ctypes.c_uint8),
        ("wTotalLength", ctypes.c_uint16), ("bNumInterfaces", ctypes.c_uint8),
        ("bConfigurationValue", ctypes.c_uint8), ("iConfiguration", ctypes.c_uint8),
        ("bmAttributes", ctypes.c_uint8), ("MaxPower", ctypes.c_uint8),
        ("interface", ctypes.POINTER(Interface)),
        ("extra", ctypes.c_void_p), ("extra_length", ctypes.c_int),
    ]

lib.libusb_init.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
lib.libusb_init.restype = ctypes.c_int
lib.libusb_get_device_list.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))]
lib.libusb_get_device_list.restype = ctypes.c_ssize_t
lib.libusb_get_device_descriptor.argtypes = [ctypes.c_void_p, ctypes.POINTER(DeviceDescriptor)]
lib.libusb_get_device_descriptor.restype = ctypes.c_int
lib.libusb_open.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
lib.libusb_open.restype = ctypes.c_int
lib.libusb_get_config_descriptor.argtypes = [ctypes.c_void_p, ctypes.c_uint8, ctypes.POINTER(ctypes.POINTER(ConfigDescriptor))]
lib.libusb_get_config_descriptor.restype = ctypes.c_int
lib.libusb_claim_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.libusb_claim_interface.restype = ctypes.c_int
lib.libusb_release_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.libusb_release_interface.restype = ctypes.c_int
lib.libusb_interrupt_transfer.argtypes = [ctypes.c_void_p, ctypes.c_uint8, ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.c_uint]
lib.libusb_interrupt_transfer.restype = ctypes.c_int
lib.libusb_strerror.argtypes = [ctypes.c_int]
lib.libusb_strerror.restype = ctypes.c_char_p
lib.libusb_close.argtypes = [ctypes.c_void_p]
lib.libusb_exit.argtypes = [ctypes.c_void_p]

def errname(rc):
    if rc == 0: return "ok"
    s = lib.libusb_strerror(rc)
    return s.decode() if s else f"{rc}"

ctx = ctypes.c_void_p()
lib.libusb_init(ctypes.byref(ctx))
lst = ctypes.POINTER(ctypes.c_void_p)()
n = lib.libusb_get_device_list(ctx, ctypes.byref(lst))
print(f"devices: {n}")

target = None
for i in range(n):
    dev = lst[i]
    d = DeviceDescriptor()
    lib.libusb_get_device_descriptor(dev, ctypes.byref(d))
    if d.idVendor == 0x0416 and d.idProduct == 0x7372:
        target = dev
        print(f"FOUND M68 HE: device[{i}] vid={d.idVendor:04x} pid={d.idProduct:04x} bcdUSB={d.bcdUSB:04x} class={d.bDeviceClass}")

if target is None:
    print("device not found"); raise SystemExit

# config descriptor
cfg = ctypes.POINTER(ConfigDescriptor)()
rc = lib.libusb_get_config_descriptor(target, 0, ctypes.byref(cfg))
print(f"get_config_descriptor -> {errname(rc)}")
if rc == 0:
    for ii in range(cfg.contents.bNumInterfaces):
        iface = cfg.contents.interface[ii]
        for aa in range(iface.num_altsetting):
            ad = iface.altsetting[aa]
            eps = []
            for ee in range(ad.bNumEndpoints):
                ep = ad.endpoint[ee]
                direction = "IN " if ep.bEndpointAddress & 0x80 else "OUT"
                eptype = {0:"control",1:"isoch",2:"bulk",3:"interrupt"}.get(ep.bmAttributes & 3, "?")
                eps.append(f"ep{ep.bEndpointAddress & 0x0f:02x}:{direction} {eptype} mps={ep.wMaxPacketSize} int={ep.bInterval}")
            print(f"  interface {ad.bInterfaceNumber} alt {ad.bAlternateSetting} class={ad.bInterfaceClass:#x} sub={ad.bInterfaceSubClass:#x} proto={ad.bInterfaceProtocol:#x} eps: {', '.join(eps)}")

# open + claim tests
handle = ctypes.c_void_p()
rc = lib.libusb_open(target, ctypes.byref(handle))
print(f"\nlibusb_open -> {errname(rc)}")
if rc == 0:
    for i in range(cfg.contents.bNumInterfaces):
        rc = lib.libusb_claim_interface(handle, i)
        print(f"claim_interface({i}) -> {errname(rc)}")
        if rc != 0:
            # keep trying others; but only one claim allowed at a time by libusb?
            pass
    # find vendor interface: class 3 (HID) with 64-byte interrupt IN+OUT
    vendor_if = None
    ep_out = ep_in = None
    for ii in range(cfg.contents.bNumInterfaces):
        iface = cfg.contents.interface[ii]
        ad = iface.altsetting[0]
        ins = outs = 0
        for ee in range(ad.bNumEndpoints):
            ep = ad.endpoint[ee]
            if ep.bmAttributes & 3 == 3:  # interrupt
                if ep.bEndpointAddress & 0x80: ins += 1
                else: outs += 1
                if ep.wMaxPacketSize == 64:
                    (ep_in if ep.bEndpointAddress & 0x80 else ep_out) and None
                    if ep.bEndpointAddress & 0x80:
                        if ep_in is None: ep_in = ep.bEndpointAddress & 0x0f
                    else:
                        if ep_out is None: ep_out = ep.bEndpointAddress & 0x0f
        if ins >= 1 and outs >= 1 and ep_in and ep_out:
            vendor_if = ii
            break
    print(f"vendor interface guess: {vendor_if}, ep_out=0x{ep_out:02x} ep_in=0x{ep_in:02x}")
    if vendor_if is not None:
        for attempt in range(3):
            rc = lib.libusb_claim_interface(handle, vendor_if)
            print(f"claim_interface({vendor_if}) attempt {attempt} -> {errname(rc)}")
            if rc == 0:
                break
            time.sleep(0.5)
        if rc == 0:
            frame = bytes([1, 0x0D]) + bytes(62)
            buf = ctypes.create_string_buffer(frame, 64)
            transferred = ctypes.c_int()
            rc = lib.libusb_interrupt_transfer(handle, 0x80 | ep_in if ep_in else 0, buf, 64, ctypes.byref(transferred), 2000)
            # write first
            outbuf = ctypes.create_string_buffer(frame, 64)
            t2 = ctypes.c_int()
            rc = lib.libusb_interrupt_transfer(handle, ep_out, outbuf, 64, ctypes.byref(t2), 2000)
            print(f"interrupt OUT ep 0x{ep_out:02x} 64B (report [1,0x0D,...]) -> {errname(rc)} transferred={t2.value}")
            time.sleep(0.3)
            inbuf = ctypes.create_string_buffer(64)
            t3 = ctypes.c_int()
            rc = lib.libusb_interrupt_transfer(handle, 0x80 | ep_in, inbuf, 64, ctypes.byref(t3), 2000)
            print(f"interrupt IN  ep 0x{ep_in:02x} -> {errname(rc)} transferred={t3.value}")
            if rc == 0:
                data = inbuf.raw[:t3.value]
                print(f"  IN data: {data.hex()}")
                print(f"  IN ascii: {bytes(b if 32 <= b < 127 else 46 for b in data).decode()}")
            lib.libusb_release_interface(handle, vendor_if)
    lib.libusb_close(handle)
lib.libusb_exit(ctx)
