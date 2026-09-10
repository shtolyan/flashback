import Tracker from "../src/Tracker";
import { AuthGate } from "../src/Auth";
export default function Index() {
  return (
    <AuthGate>
      <Tracker />
    </AuthGate>
  );
}
