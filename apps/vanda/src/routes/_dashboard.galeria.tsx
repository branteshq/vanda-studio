import { createFileRoute } from "@tanstack/react-router";
import { VandaMark } from "../components/vanda-mark";

export const Route = createFileRoute("/_dashboard/galeria")({
  component: GaleriaPage,
});

// Placeholder until the Galeria/editor slice lands — the Automático board hands
// "Eu faço" / "Começar do zero" here, so it must read as intentional, not blank.
function GaleriaPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <VandaMark size={40} />
      <h2 className="mt-5 text-[16px] font-medium text-text">A Galeria está chegando.</h2>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-[1.5] text-text-4">
        Aqui você vai compor posts, gerar imagens e editar tudo com a Vanda. Por enquanto, ela cuida
        da criação no Automático.
      </p>
    </div>
  );
}
