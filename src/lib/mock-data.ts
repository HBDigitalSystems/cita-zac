export const MUNICIPIOS = [
  "Zacatecas",
  "Guadalupe",
  "Fresnillo",
  "Jerez",
  "Río Grande",
  "Sombrerete",
  "Loreto",
  "Calera",
  "Ojocaliente",
  "Nochistlán",
  "Jalpa",
  "Pinos",
  "Villanueva",
  "Tlaltenango",
  "Miguel Auza",
  "Juan Aldama",
  "Concepción del Oro",
  "Valparaíso",
  "Mazapil",
  "Teúl de González Ortega",
] as const;

export const ESPECIALIDADES = [
  "Medicina General",
  "Pediatría",
  "Ginecología",
  "Traumatología",
  "Cardiología",
  "Neurología",
  "Oftalmología",
  "Dermatología",
  "Psiquiatría",
  "Psicología",
  "Urología",
  "Cirugía General",
  "Medicina Interna",
  "Endocrinología",
  "Neumología",
  "Reumatología",
  "Oncología",
  "Nutrición",
  "Odontología",
  "Ortopedia",
  "Otorrinolaringología",
  "Gastroenterología",
  "Nefrología",
  "Infectología",
  "Medicina Familiar",
  "Medicina del Deporte",
  "Anestesiología",
  "Medicina Estética",
  "Radiología",
  "Medicina Física y Rehabilitación",
] as const;

export const ASEGURADORAS = [
  "GNP Seguros",
  "AXA",
  "MetLife",
  "Seguros Monterrey",
  "Mapfre",
  "BUPA",
  "Allianz",
  "Atlas",
  "Qualitas",
  "Zurich Santander",
];

export const IDIOMAS = ["Español", "Inglés", "Francés", "Náhuatl"];

export type Doctor = {
  id: string;
  nombre: string;
  especialidad: (typeof ESPECIALIDADES)[number];
  subespecialidad?: string;
  municipio: (typeof MUNICIPIOS)[number];
  direccion: string;
  consultorio: string;
  fotoUrl: string;
  precio: number;
  rating: number;
  reseñas: number;
  añosExperiencia: number;
  universidad: string;
  cedula: string;
  idiomas: string[];
  aseguradoras: string[];
  aceptaNuevos: boolean;
  telemedicina: boolean;
  sexo: "M" | "F";
  biografia: string;
  proximaCita: string;
  tiempoRespuesta: string;
  servicios: string[];
  educacion: { año: number; titulo: string; institucion: string }[];
  horarios: { dia: string; rango: string }[];
};

const NOMBRES_M = [
  "Alejandro", "Carlos", "Miguel", "Fernando", "Javier", "Ricardo", "Eduardo",
  "José Luis", "Rafael", "Sergio", "Roberto", "Andrés", "Luis Enrique", "Óscar",
  "Manuel", "Diego", "Emiliano", "Héctor", "Jorge", "Pablo",
];
const NOMBRES_F = [
  "María", "Ana Sofía", "Gabriela", "Fernanda", "Laura", "Adriana", "Patricia",
  "Mónica", "Claudia", "Verónica", "Alejandra", "Daniela", "Isabel", "Carolina",
  "Lucía", "Regina", "Valeria", "Andrea", "Renata", "Mariana",
];
const APELLIDOS = [
  "Hernández", "García", "Martínez", "López", "González", "Rodríguez", "Pérez",
  "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz", "Reyes",
  "Morales", "Jiménez", "Ortiz", "Chávez", "Vázquez", "Castañeda", "Del Real",
  "Escobedo", "Muro", "Femat", "Bañuelos", "Robles", "Salcedo", "Delgado",
];
const UNIVERSIDADES = [
  "Universidad Autónoma de Zacatecas",
  "UNAM — Facultad de Medicina",
  "Universidad de Guadalajara",
  "Tecnológico de Monterrey",
  "Universidad La Salle",
  "Universidad Anáhuac",
  "IPN — Escuela Superior de Medicina",
];

// Deterministic pseudo-random so mocks are stable
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const BIOS = [
  "Médico especialista comprometido con la atención integral, la escucha activa y el tratamiento personalizado. Formación continua y trato humano en cada consulta.",
  "Enfoque preventivo y basado en evidencia. Atención cálida a pacientes de todas las edades, con seguimiento cercano y accesibilidad para dudas.",
  "Con más de una década acompañando a familias de Zacatecas, combino experiencia clínica con tecnología moderna para diagnósticos precisos.",
  "Creo en la medicina que explica, acompaña y previene. Consultas sin prisa, planes de tratamiento claros y disponibilidad para seguimiento.",
];

const SERVICIOS_POR_ESP: Record<string, string[]> = {
  Pediatría: ["Control del niño sano", "Vacunación", "Atención de urgencias pediátricas", "Asesoría de lactancia"],
  Cardiología: ["Electrocardiograma", "Ecocardiograma", "Prueba de esfuerzo", "Monitoreo Holter"],
  Ginecología: ["Papanicolaou", "Colposcopía", "Control prenatal", "Ultrasonido obstétrico"],
  Dermatología: ["Dermatoscopía", "Tratamiento de acné", "Cirugía menor", "Peelings químicos"],
  Odontología: ["Limpieza dental", "Blanqueamiento", "Endodoncia", "Ortodoncia"],
  Nutrición: ["Plan alimenticio personalizado", "Composición corporal", "Nutrición deportiva", "Control de peso"],
};

function serviciosFor(esp: string): string[] {
  return (
    SERVICIOS_POR_ESP[esp] ?? [
      "Consulta de primera vez",
      "Consulta de seguimiento",
      "Diagnóstico integral",
      "Segunda opinión médica",
    ]
  );
}

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const HORARIOS_POSIBLES = ["09:00 – 14:00", "10:00 – 15:00", "16:00 – 20:00", "08:00 – 13:00 · 16:00 – 19:00"];

function generarHorarios(rng: () => number) {
  return DIAS.filter(() => rng() > 0.15).map((d) => ({
    dia: d,
    rango: pick(rng, HORARIOS_POSIBLES),
  }));
}

const AVATAR_SEEDS = [
  "sofia", "carlos", "ana", "miguel", "gabriela", "fernando", "laura", "ricardo",
  "monica", "eduardo", "claudia", "javier", "veronica", "andres", "adriana",
  "manuel", "isabel", "diego", "carolina", "hector", "alejandra", "sergio",
  "regina", "roberto", "valeria", "oscar", "andrea", "emiliano", "renata", "jorge",
  "mariana", "pablo", "daniela", "rafael", "lucia", "luis", "patricia", "rodrigo",
  "marisol", "arturo", "yolanda",
];

function makeDoctors(): Doctor[] {
  const list: Doctor[] = [];
  const rng = seeded(42);
  for (let i = 0; i < 42; i++) {
    const sexo: "M" | "F" = rng() > 0.5 ? "F" : "M";
    const nombre = `${pick(rng, sexo === "F" ? NOMBRES_F : NOMBRES_M)} ${pick(rng, APELLIDOS)} ${pick(rng, APELLIDOS)}`;
    const esp = pick(rng, ESPECIALIDADES);
    const mun = pick(rng, MUNICIPIOS);
    const precio = [400, 500, 600, 700, 800, 900, 1000, 1200, 1500][Math.floor(rng() * 9)];
    const rating = +(3.8 + rng() * 1.2).toFixed(1);
    const reseñas = 12 + Math.floor(rng() * 340);
    const exp = 3 + Math.floor(rng() * 28);
    const avatarSeed = AVATAR_SEEDS[i % AVATAR_SEEDS.length];
    const idiomas = ["Español", ...(rng() > 0.4 ? ["Inglés"] : []), ...(rng() > 0.9 ? ["Francés"] : [])];
    const aseg = ASEGURADORAS.filter(() => rng() > 0.55).slice(0, 5);
    const horaProx = 8 + Math.floor(rng() * 10);
    const diaProx = ["Hoy", "Mañana", "Jueves", "Viernes", "Lunes"][Math.floor(rng() * 5)];

    list.push({
      id: `dr-${i + 1}`,
      nombre: `Dr${sexo === "F" ? "a" : ""}. ${nombre}`,
      especialidad: esp,
      municipio: mun,
      direccion: `Av. ${pick(rng, ["Hidalgo", "Juárez", "González Ortega", "López Mateos", "Universidad", "Insurgentes"])} ${100 + Math.floor(rng() * 899)}, Col. Centro`,
      consultorio: `Consultorio ${100 + Math.floor(rng() * 400)}`,
      fotoUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=${avatarSeed}&backgroundColor=b6e3f4,c0aede,d1d4f9`,
      precio,
      rating,
      reseñas,
      añosExperiencia: exp,
      universidad: pick(rng, UNIVERSIDADES),
      cedula: `${1000000 + Math.floor(rng() * 8999999)}`,
      idiomas,
      aseguradoras: aseg,
      aceptaNuevos: rng() > 0.15,
      telemedicina: rng() > 0.35,
      sexo,
      biografia: pick(rng, BIOS),
      proximaCita: `${diaProx} ${horaProx}:${rng() > 0.5 ? "00" : "30"}`,
      tiempoRespuesta: pick(rng, ["< 1 h", "< 2 h", "Hoy mismo", "< 24 h"]),
      servicios: serviciosFor(esp),
      educacion: [
        { año: 2000 + Math.floor(rng() * 15), titulo: "Médico Cirujano", institucion: pick(rng, UNIVERSIDADES) },
        { año: 2010 + Math.floor(rng() * 12), titulo: `Especialidad en ${esp}`, institucion: pick(rng, UNIVERSIDADES) },
      ],
      horarios: generarHorarios(rng),
    });
  }
  return list;
}

export const DOCTORS: Doctor[] = makeDoctors();

export function getDoctor(id: string) {
  return DOCTORS.find((d) => d.id === id);
}

export const ESPECIALIDADES_DESTACADAS = [
  { nombre: "Medicina General", icono: "🩺" },
  { nombre: "Pediatría", icono: "👶" },
  { nombre: "Ginecología", icono: "🌸" },
  { nombre: "Cardiología", icono: "❤️" },
  { nombre: "Dermatología", icono: "✨" },
  { nombre: "Odontología", icono: "🦷" },
  { nombre: "Psicología", icono: "🧠" },
  { nombre: "Nutrición", icono: "🥗" },
] as const;
