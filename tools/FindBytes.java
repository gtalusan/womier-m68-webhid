// Search memory for a byte pattern, print matches + xrefs to them.
// Usage: -postScript FindBytes.java <outFile> <hex bytes>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;

public class FindBytes extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) { println("usage: FindBytes.java <outFile> <hexbytes>"); return; }
        PrintWriter pw = new PrintWriter(new FileWriter(args[0]));
        String hex = args[1].replaceAll("\\s", "");
        byte[] pat = new byte[hex.length() / 2];
        for (int i = 0; i < pat.length; i++)
            pat[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        Memory mem = currentProgram.getMemory();
        Address addr = currentProgram.getMinAddress();
        int n = 0;
        while (true) {
            addr = mem.findBytes(addr, pat, null, true, monitor);
            if (addr == null) break;
            n++;
            pw.println("## pattern @ " + addr);
            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(addr);
            while (it.hasNext()) {
                Reference r = it.next();
                Function f = currentProgram.getFunctionManager().getFunctionContaining(r.getFromAddress());
                pw.println("   xref " + r.getFromAddress() + "  in " + (f != null ? f.getName() : "?"));
            }
            addr = addr.add(1);
        }
        pw.close();
        println("found " + n + " matches -> " + args[0]);
    }
}
