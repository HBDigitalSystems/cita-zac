// El logotipo de DoctorCita, tal cual lo entregó el cliente: el símbolo con el
// nombre y la línea de abajo.
//
// Estaba repetido a mano en la cabecera, el pie, el panel y las pantallas de
// acceso. Al cambiar el logotipo habría que haber tocado los cuatro y era
// cuestión de tiempo que uno se quedara atrás.

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      // Vacío y oculto a propósito: en la cabecera y en el panel el nombre va
      // escrito al lado, y un alt con el nombre haría que un lector de
      // pantalla dijera «DoctorCita DoctorCita Zacatecas».
      alt=""
      aria-hidden="true"
      width={1048}
      height={967}
      // La altura la fija quien lo usa; el ancho se deduce solo para no
      // deformar el logotipo. `w-auto` es imprescindible: sin él, la clase de
      // altura sola dejaría el ancho intrínseco de 1048 px.
      className={cn("w-auto object-contain", className)}
    />
  );
}
