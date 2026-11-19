// Find direct CALL instructions whose flow target equals a target address.
// Usage: -postScript FindCalls.java <0xtarget> <outfile>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import java.io.*;

public class FindCalls extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        long target = Long.parseLong(args[0].replace("0x", ""), 16);
        PrintWriter pw = new PrintWriter(new FileWriter(args[1]));
        InstructionIterator it = currentProgram.getListing().getInstructions(true);
        int n = 0;
        while (it.hasNext()) {
            Instruction ins = it.next();
            if (!ins.getFlowType().isCall()) continue;
            boolean hit = false;
            Address[] flows = ins.getFlows();
            if (flows != null) {
                for (int i = 0; i < flows.length; i++) {
                    Address a = flows[i];
                    if (a != null && a.getOffset() == target) { hit = true; break; }
                }
            }
            if (!hit) {
                Reference[] refs = currentProgram.getReferenceManager().getReferencesFrom(ins.getAddress());
                for (int i = 0; i < refs.length; i++) {
                    Address to = refs[i].getToAddress();
                    if (to != null && to.getOffset() == target) { hit = true; break; }
                }
            }
            if (hit) {
                Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
                pw.println(ins.getAddress() + "  " + ins + "   in " + (f != null ? f.getName() : "?"));
                n++;
            }
        }
        pw.close();
        println("found " + n + " callers, written to " + args[1]);
    }
}
