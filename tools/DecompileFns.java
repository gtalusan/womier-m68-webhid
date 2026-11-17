// Decompile named functions (or address ranges) to files.
// Usage: analyzeHeadless <proj> <name> -process <bin> -noanalysis
//   -postScript DecompileFns.java <outDir> <name1|0xADDR1-0xADDR2,name2,...>
// Names are matched case-insensitively by substring; addresses are hex.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;

public class DecompileFns extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) {
            println("usage: DecompileFns.java <outDir> <spec,spec,...>");
            return;
        }
        String outDir = args[0];
        new File(outDir).mkdirs();
        String[] specs = args[1].split(",");
        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);
        DecompileOptions opts = new DecompileOptions();
        opts.setMaxPayloadMBytes(512);
        decomp.setOptions(opts);

        for (String spec : specs) {
            spec = spec.trim();
            if (spec.isEmpty()) continue;
            if (spec.contains("-")) {
                String[] parts = spec.split("-");
                long a = Long.parseLong(parts[0].substring(2), 16);
                long b = Long.parseLong(parts[1].substring(2), 16);
                FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
                while (it.hasNext()) {
                    Function f = it.next();
                    if (f.getEntryPoint().getOffset() >= a && f.getEntryPoint().getOffset() < b)
                        dumpOne(decomp, f, outDir);
                }
            } else {
                FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
                boolean found = false;
                while (it.hasNext()) {
                    Function f = it.next();
                    if (f.getName().toLowerCase().contains(spec.toLowerCase())) {
                        dumpOne(decomp, f, outDir);
                        found = true;
                    }
                }
                if (!found) println("!! no function matching: " + spec);
            }
        }
    }

    private void dumpOne(DecompInterface decomp, Function f, String outDir) throws Exception {
        DecompileResults dr = decomp.decompileFunction(f, 60, monitor);
        if (dr == null || !dr.decompileCompleted()) {
            println("!! failed to decompile " + f.getName());
            return;
        }
        DecompiledFunction df = dr.getDecompiledFunction();
        String c = df.getC();
        String fname = outDir + File.separator + f.getName().replaceAll("[^A-Za-z0-9_.]", "_")
                + "_" + Long.toHexString(f.getEntryPoint().getOffset()) + ".c";
        PrintWriter pw = new PrintWriter(new FileWriter(fname));
        pw.print(c);
        pw.close();
        println("dumped " + fname + " (" + c.length() + " bytes)");
    }
}
