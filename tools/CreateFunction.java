// Create a function at an address (for undefined code Ghidra missed).
// Usage: -postScript CreateFunction.java <0xaddr> [name]
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class CreateFunction extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        long addr = Long.parseLong(args[0].substring(2), 16);
        Address a = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(addr);
        Function f = currentProgram.getFunctionManager().getFunctionAt(a);
        if (f != null) { println("already a function: " + f.getName()); return; }
        // disassemble first so createFunction has instructions to work with
        disassemble(a);
        f = createFunction(a, args.length > 1 ? args[1] : "FUN_" + Long.toHexString(addr));
        if (f == null) println("!! createFunction failed at " + a);
        else println("created " + f.getName() + " at " + a);
    }
}
