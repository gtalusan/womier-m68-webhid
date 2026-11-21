// Find instructions whose memory operand uses one of the given displacements.
// Usage: -postScript FindDisp.java <outFile> <0x188,0x18c,...>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import java.io.*;

public class FindDisp extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) { println("usage: FindDisp.java <outFile> <0xdisp,...>"); return; }
        java.util.Set<Long> want = new java.util.HashSet<>();
        for (String s : args[1].split(",")) {
            want.add(Long.parseLong(s.trim().replace("0x", ""), 16));
        }
        PrintWriter pw = new PrintWriter(new FileWriter(args[0]));
        InstructionIterator it = currentProgram.getListing().getInstructions(true);
        int n = 0;
        while (it.hasNext()) {
            Instruction ins = it.next();
            boolean hit = false;
            if (!ins.toString().contains("ptr [")) continue;
            for (int op = 0; op < ins.getNumOperands() && !hit; op++) {
                for (Object o : ins.getOpObjects(op)) {
                    if (o instanceof Scalar) {
                        if (want.contains(((Scalar) o).getUnsignedValue())) { hit = true; break; }
                    }
                }
            }
            if (hit) {
                Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
                pw.println(ins.getAddress() + "  " + ins + "   in " + (f != null ? f.getName() : "?"));
                n++;
            }
        }
        pw.close();
        println("found " + n + " instructions -> " + args[0]);
    }
}
