import { redirect } from "next/navigation";

/**
 * The standalone Formularies tab is gone: drug lists live under each plan
 * (Carriers → plan workspace) and QA happens inside the upload wizard.
 */
export default function FormulariesRedirect() {
  redirect("/admin/carriers");
}
