// m68hid.c — macOS transport shim: interrupt pipe I/O to the M68 HE
// vendor interface (interface 2: ep 0x04 OUT, ep 0x83 IN, 64 B).
//
// Build: clang -O2 -framework IOKit -framework CoreFoundation -o m68hid m68hid.c
//
// Usage:
//   m68hid probe          — find device, open interface, list pipes
//   m68hid handshake      — send {1,0x0D,0..} and print the response
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/IOCFPlugIn.h>
#include <IOKit/usb/IOUSBLib.h>
#include <IOKit/usb/USBSpec.h>

#define VID 0x0416
#define PID 0x7372
#define VENDOR_IFACE 2

static UInt32 get_num_prop(io_service_t svc, CFStringRef key) {
    CFTypeRef v = IORegistryEntrySearchCFProperty(svc, kIOServicePlane, key,
                                                  kCFAllocatorDefault,
                                                  kIORegistryIterateRecursively);
    if (!v) return 0xFFFFFFFF;
    UInt32 n = 0;
    CFNumberGetValue((CFNumberRef)v, kCFNumberSInt32Type, &n);
    CFRelease(v);
    return n;
}

int main(int argc, char **argv) {
    const char *mode = (argc > 1) ? argv[1] : "probe";

    // ---- 1. find the IOUSBHostDevice with VID/PID, then its interface 2
    CFMutableDictionaryRef match = IOServiceMatching("IOUSBHostDevice");
    io_iterator_t iter;
    kern_return_t kr = IOServiceGetMatchingServices(kIOMainPortDefault, match, &iter);
    if (kr != KERN_SUCCESS) { fprintf(stderr, "IOServiceGetMatchingServices: 0x%x\n", kr); return 1; }

    io_service_t target_if = 0;
    io_service_t dev;
    while ((dev = IOIteratorNext(iter))) {
        if (get_num_prop(dev, CFSTR("idVendor")) == VID &&
            get_num_prop(dev, CFSTR("idProduct")) == PID) {
            io_iterator_t it2;
            IORegistryEntryGetChildIterator(dev, kIOServicePlane, &it2);
            io_service_t child;
            while ((child = IOIteratorNext(it2))) {
                if (get_num_prop(child, CFSTR("bInterfaceNumber")) == VENDOR_IFACE) {
                    target_if = child;
                } else {
                    IOObjectRelease(child);
                }
            }
            IOObjectRelease(it2);
            IOObjectRelease(dev);
            break;
        }
        IOObjectRelease(dev);
    }
    IOObjectRelease(iter);
    if (!target_if) { fprintf(stderr, "M68 HE vendor interface not found (plugged in?)\n"); return 1; }
    printf("found IOUSBInterfaceDevice for interface %d\n", VENDOR_IFACE);

    // ---- 2. create the IOUSBInterfaceInterface (legacy IOUSBLib)
    IOCFPlugInInterface **plugin = NULL;
    SInt32 score = 0;
    kr = IOCreatePlugInInterfaceForService(target_if, kIOUSBInterfaceUserClientTypeID,
                                           kIOCFPlugInInterfaceID, &plugin, &score);
    if (kr != KERN_SUCCESS || !plugin) { fprintf(stderr, "IOCreatePlugInInterfaceForService: 0x%x\n", kr); return 1; }

    IOUSBInterfaceInterface190 **iface = NULL;
    kr = (*plugin)->QueryInterface(plugin, CFUUIDGetUUIDBytes(kIOUSBInterfaceInterfaceID190),
                                   (LPVOID *)&iface);
    (*plugin)->Release(plugin);
    if (kr != KERN_SUCCESS || !iface) { fprintf(stderr, "QueryInterface(190): 0x%x\n", kr); return 1; }

    // ---- 3. open the interface
    kr = (*iface)->USBInterfaceOpen(iface);
    printf("USBInterfaceOpen -> 0x%08x", kr);
    if (kr == kIOReturnExclusiveAccess) printf(" (kIOReturnExclusiveAccess)");
    if (kr == kIOReturnNotPermitted) printf(" (kIOReturnNotPermitted)");
    printf("\n");
    if (kr != KERN_SUCCESS) { fprintf(stderr, "interface open failed — IOHIDFamily holds it exclusively?\n"); return 1; }

    // ---- 4. pipes
    UInt8 num_endpoints = 0;
    (*iface)->GetNumEndpoints(iface, &num_endpoints);
    printf("endpoints: %u\n", num_endpoints);
    int out_pipe = 0, in_pipe = 0;
    for (int p = 1; p <= num_endpoints; p++) {
        UInt8 direction, number, transfer_type, interval;
        UInt16 max_packet_size;
        (*iface)->GetPipeProperties(iface, p, &direction, &number, &transfer_type,
                                    &max_packet_size, &interval);
        printf("  pipe %d: dir=%s type=%s ep=0x%02x mps=%u interval=%u\n", p,
               direction == kUSBOut ? "OUT" : (direction == kUSBIn ? "IN" : "?X"),
               transfer_type == kUSBInterrupt ? "interrupt" : (transfer_type == kUSBBulk ? "bulk" : "?Y"),
               number, max_packet_size, interval);
        if (transfer_type == kUSBInterrupt) {
            if (direction == kUSBOut) out_pipe = p;
            else if (direction == kUSBIn) in_pipe = p;
        }
    }
    printf("interrupt OUT pipe=%d, IN pipe=%d\n", out_pipe, in_pipe);
    if (!out_pipe || !in_pipe) { fprintf(stderr, "pipes not found\n"); return 1; }

    if (!strcmp(mode, "handshake") || !strcmp(mode, "probe")) {
        // ---- 5. handshake: {1, 0x0D, 0...} (report ID 1 + wire cmd 0x0D)
        UInt8 frame[64];
        memset(frame, 0, sizeof(frame));
        frame[0] = 1;      // report ID
        frame[1] = 0x0D;   // get device info
        kr = (*iface)->WritePipe(iface, out_pipe, frame, 64);
        printf("WritePipe(64B [01 0d 00..]) -> 0x%08x\n", kr);
        if (kr == KERN_SUCCESS) {
            UInt8 buf[64];
            UInt32 got = 0;
            memset(buf, 0, sizeof(buf));
            kr = (*iface)->ReadPipe(iface, in_pipe, buf, &got);
            printf("ReadPipe -> 0x%08x got=%u\n", kr, got);
            if (kr == KERN_SUCCESS && got > 0) {
                printf("  hex  : ");
                for (UInt32 i = 0; i < got && i < 64; i++) printf("%02x", buf[i]);
                printf("\n");
                printf("  ascii: ");
                for (UInt32 i = 0; i < got && i < 64; i++)
                    putchar(buf[i] >= 32 && buf[i] < 127 ? buf[i] : '.');
                printf("\n");
            }
        }
        if (!strcmp(mode, "handshake")) {
            // SN query {1, 0x15, 0..}
            memset(frame, 0, sizeof(frame));
            frame[0] = 1; frame[1] = 0x15;
            kr = (*iface)->WritePipe(iface, out_pipe, frame, 64);
            printf("WritePipe(SN query [01 15]) -> 0x%08x\n", kr);
            usleep(300000);
            UInt8 buf[64]; UInt32 got = 0;
            kr = (*iface)->ReadPipe(iface, in_pipe, buf, &got);
            printf("ReadPipe -> 0x%08x got=%u\n", kr, got);
            if (kr == KERN_SUCCESS && got > 0) {
                printf("  hex  : ");
                for (UInt32 i = 0; i < got && i < 64; i++) printf("%02x", buf[i]);
                printf("\n  ascii: ");
                for (UInt32 i = 0; i < got && i < 64; i++)
                    putchar(buf[i] >= 32 && buf[i] < 127 ? buf[i] : '.');
                printf("\n");
            }
        }
    }

    (*iface)->USBInterfaceClose(iface);
    (*iface)->Release(iface);
    IOObjectRelease(target_if);
    printf("done\n");
    return 0;
}
