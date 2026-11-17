// Dump raw disassembly listing for an address range.
// Usage: -postScript DumpListing.java <outFile> <0xstart-0xend>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;

public class DumpListing extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) { println("usage: DumpListing.java <outFile> <0xstart-0xend>"); return; }
        String[] parts = args[1].split("-");
        long a = Long.parseLong(parts[0].substring(2), 16);
        long b = Long.parseLong(parts[1].substring(2), 16);
        PrintWriter pw = new PrintWriter(new FileWriter(args[0]));
        AddressSpace space = currentProgram.getAddressFactory().getDefaultAddressSpace();
        Listing listing = currentProgram.getListing();
        for (long x = a; x <= b; x++) {
            Address ad = space.getAddress(x);
            Instruction ins = listing.getInstructionAt(ad);
            if (ins != null) {
                pw.println(ad + "  " + ins);
                x += ins.getLength() - 1;
            }
        }
        pw.close();
        println("listing written to " + args[0]);
    }
}
