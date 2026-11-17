// Find all instructions referencing a struct offset (e.g. +0x224) and
// print the containing function + instruction.
// Usage: -postScript FindOffset.java <hex offset> <outfile>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;

public class FindOffset extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        long off = Long.parseLong(args[0], 16);
        String hex = String.format("0x%x", off);
        PrintWriter pw = new PrintWriter(new FileWriter(args[1]));
        InstructionIterator it = currentProgram.getListing().getInstructions(true);
        int n = 0;
        while (it.hasNext() && n < 200) {
            Instruction ins = it.next();
            String s = ins.toString().replace(" ", "");
            if (s.contains("[" + hex + "]") || s.contains("+" + hex)) {
                Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
                pw.println(ins.getAddress() + "  " + ins + "   in " + (f != null ? f.getName() : "?"));
                n++;
            }
        }
        pw.close();
        println("found " + n + " refs, written to " + args[1]);
    }
}
