package com.bizh.app;

import android.graphics.Path;

/**
 * The brand mark (three chevrons) as an android.graphics.Path, in the logo's own
 * units: 100 wide, 90.92 tall. Same geometry as public/brand/heller-mark.svg and
 * components/ui/brand-mark.tsx; keep them in sync if the artwork changes.
 *
 * The artwork is straight lines only (M / L / Z), so it's read here directly
 * instead of through a general SVG path parser.
 */
final class BrandMark {

    static final float WIDTH = 100f;
    static final float HEIGHT = 90.92f;

    private static final String[] PATHS = {
        "M 99.54 31.20 L 87.41 38.81 L 49.96 15.30 L 12.40 38.88 L 0.16 31.20 L 49.85 0.00 Z",
        "M 0.00 41.88 L 12.29 49.60 L 49.85 26.02 L 87.39 49.59 L 100.00 41.68 L 100.00 57.04 L 87.49 64.90 L 75.25 57.22 L 49.96 41.32 L 12.40 64.90 L 0.16 57.22 L 0.00 57.11 Z",
        "M 0.00 67.90 L 12.29 75.62 L 49.85 52.04 L 87.39 75.61 L 100.00 67.70 L 100.00 83.06 L 87.49 90.92 L 75.25 83.23 L 49.96 67.33 L 12.40 90.92 L 0.16 83.23 L 0.00 83.13 Z",
    };

    private BrandMark() {}

    static Path create() {
        Path path = new Path();
        for (String data : PATHS) {
            String[] tokens = data.trim().split("\\s+");
            int i = 0;
            while (i < tokens.length) {
                String command = tokens[i++];
                if (command.equals("Z")) {
                    path.close();
                } else {
                    float x = Float.parseFloat(tokens[i++]);
                    float y = Float.parseFloat(tokens[i++]);
                    if (command.equals("M")) {
                        path.moveTo(x, y);
                    } else {
                        path.lineTo(x, y);
                    }
                }
            }
        }
        return path;
    }
}
