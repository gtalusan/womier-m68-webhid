// Find instructions storing an immediate byte value, dump containing function.
// Usage: -postScript FindStore.java <outFile> <val>  (val in hex, e.g. 0e)
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.*;
import java.util.regex.*;

public class FindStore extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) { println("usage: FindStore.java <outFile> <valHex>"); return; }
        PrintWriter pw = new PrintWriter(new FileWriter(args[0]));
        String val = args[1].toLowerCase();
        if (!val.startsWith("0x")) val = "0x" + val;
        // matches: MOV byte ptr [reg + 0x5],0xe  (any store of the value to a byte target)
        Pattern p = Pattern.compile("(?i)mov\\s+byte ptr \\[[^]]*\\],\\s*" + val + "\\s*$");
        InstructionIterator it = currentProgram.getListing().getInstructions(true);
        int n = 0;
        while (it.hasNext()) {
            Instruction ins = it.next();
            String s = ins.toString();
            if (p.matcher(s.trim()).matches()) {
                Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
                pw.println(ins.getAddress() + "  " + s + "   in " + (f != null ? f.getName() : "?"));
                n++;
            }
        }
        pw.close();
        println("found " + n + " stores of " + val + " -> " + args[0]);
    }
}
