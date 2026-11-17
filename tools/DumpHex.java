// Dump raw memory as hex pairs. Usage: -postScript DumpHex.java <outFile> <0xstart-0xend>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.mem.*;
import java.io.*;

public class DumpHex extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) { println("usage: DumpHex.java <outFile> <0xstart-0xend>"); return; }
        String[] parts = args[1].split("-");
        long a = Long.parseLong(parts[0].substring(2), 16);
        long b = Long.parseLong(parts[1].substring(2), 16);
        PrintWriter pw = new PrintWriter(new FileWriter(args[0]));
        Memory mem = currentProgram.getMemory();
        int len = (int)(b - a + 1);
        byte[] buf = new byte[len];
        mem.getBytes(currentProgram.getMinAddress().getNewAddress(a), buf);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < len; i++) sb.append(String.format("%02x", buf[i]));
        pw.println(sb.toString());
        pw.close();
        println("hex written to " + args[0] + " (" + len + " bytes)");
    }
}
