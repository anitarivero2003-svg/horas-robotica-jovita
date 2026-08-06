HORAS ROBÓTICA JOVITA — PROYECTO WEB YA CONFIGURADO

La URL del proyecto y la Publishable key de Supabase ya están colocadas en config.js.

PASOS QUE FALTAN
1. En Supabase > SQL Editor, ejecutar una sola vez el contenido de supabase-seguridad.sql.
2. Crear en Authentication una cuenta para cada trabajadora.
3. Crear en la tabla public.usuarios una fila para cada cuenta, usando exactamente el mismo UID.
4. Subir TODOS los archivos de esta carpeta a la raíz de un repositorio de GitHub.
5. Importar el repositorio desde Vercel y presionar Deploy.

IMPORTANTE
- No publicar ni usar una secret key o service_role.
- Cada trabajadora verá únicamente sus horas; Ana Bazan, con rol admin, verá la planilla completa.
- Los períodos se calculan del día 20 de un mes al día 19 del siguiente.
