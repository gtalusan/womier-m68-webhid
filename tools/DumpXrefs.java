// Dump xrefs to a memory range (e.g. an import IAT block) with the
// containing function name and the xref address.
// Usage: ... -postScript DumpXrefs.java <outFile> <0xstart-0xend>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.symbol.*;
import java.io.*;

public class DumpXrefs extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) { println("usage: DumpXrefs.java <outFile> <0xstart-0xend>"); return; }
        String outFile = args[0];
        String[] parts = args[1].split("-");
        long a = Long.parseLong(parts[0].substring(2), 16);
        long b = Long.parseLong(parts[1].substring(2), 16);
        PrintWriter pw = new PrintWriter(new FileWriter(outFile));
        AddressSpace space = currentProgram.getAddressFactory().getDefaultAddressSpace();
        for (long x = a; x <= b; x++) {
            Address to = space.getAddress(x);
            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(to);
            while (it.hasNext()) {
                Reference r = it.next();
                Address from = r.getFromAddress();
                Function f = currentProgram.getFunctionManager().getFunctionContaining(from);
                String fname = (f == null) ? "?" : f.getName();
                pw.println(String.format("0x%08x -> 0x%08x  in %s", from.getOffset(), to.getOffset(), fname));
            }
        }
        pw.close();
        println("xrefs written to " + outFile);
    }
}
