// Print symbols matching a substring with their addresses.
// Usage: -postScript NameToAddr.java <substring>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.symbol.*;
import ghidra.program.model.listing.*;

public class NameToAddr extends GhidraScript {
    @Override
    public void run() throws Exception {
        String sub = getScriptArgs()[0].toLowerCase();
        SymbolTable st = currentProgram.getSymbolTable();
        SymbolIterator it = st.getAllSymbols(true);
        int n = 0;
        while (it.hasNext() && n < 200) {
            Symbol s = it.next();
            if (s.getName().toLowerCase().contains(sub)) {
                println(s.getAddress() + "  " + s.getName() + "  [" + s.getSymbolType() + "]");
                n++;
            }
        }
        println("matches printed: " + n);
    }
}
