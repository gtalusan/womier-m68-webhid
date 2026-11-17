// Find CMP instructions with an immediate, dump containing function.
// Usage: -postScript FindCmp.java <outFile> <valHex>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.*;
import java.util.regex.*;

public class FindCmp extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) { println("usage: FindCmp.java <outFile> <valHex>"); return; }
        PrintWriter pw = new PrintWriter(new FileWriter(args[0]));
        String val = args[1].toLowerCase();
        if (!val.startsWith("0x")) val = "0x" + val;
        Pattern p = Pattern.compile("(?i)^cmp\\s+.*,\\s*" + val + "\\s*$");
        InstructionIterator it = currentProgram.getListing().getInstructions(true);
        int n = 0;
        while (it.hasNext()) {
            Instruction ins = it.next();
            String s = ins.toString().trim();
            if (p.matcher(s).matches()) {
                Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
                pw.println(ins.getAddress() + "  " + s + "   in " + (f != null ? f.getName() : "?"));
                n++;
            }
        }
        pw.close();
        println("found " + n + " cmps of " + val + " -> " + args[0]);
    }
}
