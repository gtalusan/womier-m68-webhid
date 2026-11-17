// Find strings (ASCII + UTF-16LE) in memory and dump their xrefs with
// containing functions. Usage:
//   -postScript FindString.java <outFile> <str1|str2|...>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class FindString extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) {
            println("usage: FindString.java <outFile> <str1|str2|...>");
            return;
        }
        PrintWriter pw = new PrintWriter(new FileWriter(args[0]));
        String[] targets = args[1].split("\\|");
        Memory mem = currentProgram.getMemory();
        for (String t : targets) {
            byte[] ascii = t.getBytes(StandardCharsets.US_ASCII);
            byte[] utf16 = t.getBytes(StandardCharsets.UTF_16LE);
            search(pw, mem, t, ascii, "ascii");
            search(pw, mem, t, utf16, "utf16");
        }
        pw.close();
        println("done -> " + args[0]);
    }

    private void search(PrintWriter pw, Memory mem, String target, byte[] pat, String enc) {
        Address addr = currentProgram.getMinAddress();
        while (true) {
            addr = mem.findBytes(addr, pat, null, true, monitor);
            if (addr == null) break;
            pw.println("## " + target + " [" + enc + "] @ " + addr);
            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(addr);
            while (it.hasNext()) {
                Reference r = it.next();
                Address from = r.getFromAddress();
                Function f = currentProgram.getFunctionManager().getFunctionContaining(from);
                pw.println("   xref " + from + "  in " + (f != null ? f.getName() : "?"));
            }
            addr = addr.add(1);
        }
    }
}
