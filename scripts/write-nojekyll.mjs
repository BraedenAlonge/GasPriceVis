import {writeFileSync} from "node:fs";

writeFileSync(new URL("../dist/.nojekyll", import.meta.url), "");
