// Dump raw dwords of a memory range.
// Usage: -postScript DumpDwords.java <outFile> <0xstart-0xend>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;
import java.io.*;

public class DumpDwords extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String[] parts = args[1].split("-");
        long a = Long.parseLong(parts[0].substring(2), 16);
        long b = Long.parseLong(parts[1].substring(2), 16);
        PrintWriter pw = new PrintWriter(new FileWriter(args[0]));
        Memory mem = currentProgram.getMemory();
        for (long x = a; x < b; x += 4) {
            Address ad = currentProgram.getMinAddress().getNewAddress(x);
            try {
                int v = mem.getInt(ad);
                pw.println(String.format("0x%08x 0x%08x", x, v & 0xffffffffL));
            } catch (Exception e) {
                pw.println(String.format("0x%08x <unmapped>", x));
            }
        }
        pw.close();
        println("dwords written to " + args[0]);
    }
}
