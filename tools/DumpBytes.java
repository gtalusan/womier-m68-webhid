// Dump raw bytes of a memory range as printable ASCII lines, with addresses.
// Usage: -postScript DumpBytes.java <outFile> <0xstart-0xend>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.*;
import java.io.*;

public class DumpBytes extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) { println("usage: DumpBytes.java <outFile> <0xstart-0xend>"); return; }
        String[] parts = args[1].split("-");
        long a = Long.parseLong(parts[0].substring(2), 16);
        long b = Long.parseLong(parts[1].substring(2), 16);
        PrintWriter pw = new PrintWriter(new FileWriter(args[0]));
        Memory mem = currentProgram.getMemory();
        int len = (int)(b - a + 1);
        byte[] buf = new byte[len];
        mem.getBytes(currentProgram.getMinAddress().getNewAddress(a), buf);
        for (int i = 0; i < len; i += 16) {
            StringBuilder sb = new StringBuilder();
            sb.append(String.format("0x%08x |", a + i));
            for (int j = 0; j < 16 && i + j < len; j++) {
                int c = buf[i + j] & 0xff;
                sb.append(c >= 32 && c < 127 ? (char) c : '.');
            }
            pw.println(sb.toString());
        }
        pw.close();
        println("bytes written to " + args[0]);
    }
}
