export const PROVINCIAS_ARGENTINA = [
  { nombre: "Buenos Aires", codigo: 1 },
  { nombre: "Catamarca", codigo: 2 },
  { nombre: "Chaco", codigo: 3 },
  { nombre: "Chubut", codigo: 4 },
  { nombre: "Córdoba", codigo: 5 },
  { nombre: "Corrientes", codigo: 6 },
  { nombre: "Entre Ríos", codigo: 7 },
  { nombre: "Formosa", codigo: 8 },
  { nombre: "Jujuy", codigo: 9 },
  { nombre: "La Pampa", codigo: 10 },
  { nombre: "La Rioja", codigo: 11 },
  { nombre: "Mendoza", codigo: 12 },
  { nombre: "Misiones", codigo: 13 },
  { nombre: "Neuquén", codigo: 14 },
  { nombre: "Río Negro", codigo: 15 },
  { nombre: "Salta", codigo: 16 },
  { nombre: "San Juan", codigo: 17 },
  { nombre: "San Luis", codigo: 18 },
  { nombre: "Santa Cruz", codigo: 19 },
  { nombre: "Santa Fe", codigo: 20 },
  { nombre: "Santiago del Estero", codigo: 21 },
  { nombre: "Tierra del Fuego", codigo: 22 },
  { nombre: "Tucumán", codigo: 23 },
  { nombre: "CABA", codigo: 24 },
] as const

export const TIPOS_IVA_DJ = [
  { nombre: "Sujeto Excento", codigo: 1 },
  { nombre: "Responsable Inscripto", codigo: 2 },
  { nombre: "Consumidor Final", codigo: 4 },
  { nombre: "Excento Ley", codigo: 5 },
  { nombre: "Monotributo", codigo: 6 },
  { nombre: "Responsable Monotributo", codigo: 7 },
  { nombre: "No Categorizado", codigo: 8 },
  { nombre: "Responsable Inscripto RG4520", codigo: 9 },
] as const

export const CONDICIONES_PAGO = [
  { nombre: "Cuenta Corriente", valor: "cuenta_corriente", codigo: "CC" },
  { nombre: "Contado", valor: "contado", codigo: "E" },
  { nombre: "Anticipado", valor: "anticipado", codigo: "A" },
] as const
