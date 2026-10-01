/**
 * Marcador del pool sin asignar en los selectores de origen/destino.
 *
 * Vive en su propio módulo porque un archivo `"use server"` solo puede
 * exportar funciones async: una constante ahí rompe el módulo entero.
 */
export const POOL = "__pool__";
