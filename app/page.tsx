import { PureWorthApp } from "../components/pureworth-app";
import { publicBetaFlags } from "../lib/beta/config";

export const dynamic = "force-dynamic";

export default function Home() {
  return <PureWorthApp beta={publicBetaFlags()} />;
}
