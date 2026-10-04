import Navbar from "./Navbar";
import GazetteShell from "./GazetteShell";
import { useTheme } from "../hooks/useTheme";

function AppLayout({ children, rightSlot, reader, statusCount, showBrand }) { // showBrand (optional): true = always show the WordKnit name at the top of the page
    const { isGazette } = useTheme();

    if (isGazette) {
        return (
            <GazetteShell reader={reader} statusCount={statusCount} rightSlot={rightSlot} showBrand={showBrand}> {/* parent → child: passes showBrand down to the shell */}
                {children}
            </GazetteShell>
        );
    }

    return (
        <div className="app-layout">
            <Navbar />
            <div className={`main-content${reader ? " main-content--reader" : ""}`}>
                {children}
            </div>
        </div>
    );
}

export default AppLayout;
