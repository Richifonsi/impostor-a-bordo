# Impostor a Bordo

Partida por turnos en el navegador, al estilo Among Us, con la interfaz en español. Hay una sola sala: todo el mundo que abre la página entra a la misma partida.

## Desplegar en Render

1. Entra al [panel de Render](https://dashboard.render.com).
2. Pulsa **New** y elige **Blueprint**.
3. Conecta este repositorio. Render lee el `render.yaml` de la raíz y crea el servicio web gratuito `impostor-a-bordo`.
4. Revisa el plan y pulsa **Deploy Blueprint**.
5. Cuando el deploy termine, abre la URL del servicio y compártela. Quien entre con esa dirección juega en la misma sala.

El plan gratuito se duerme tras unos 15 minutos sin visitas. La siguiente petición lo despierta y puede tardar cerca de un minuto. La partida vive en memoria: si el servicio se reinicia o se duerme, la sala vuelve a empezar.

Para probar en local:

```bash
python server.py
```

Abre http://localhost:8765. El proceso escucha en `0.0.0.0` y toma el puerto de la variable de entorno `PORT` (por defecto `8765`). No hace falta instalar paquetes: basta la biblioteca estándar de Python 3.

## Cómo jugar

Hacen falta al menos 3 personas, cada una con la misma URL en su navegador.

1. Escribe un nombre y pulsa **Entrar**.
2. Cuando estén todos, alguien pulsa **Empezar partida**. Con 7 o más jugadores hay dos impostores; con menos, uno.
3. **Tripulante:** muévete con clic en las salas de borde verde y completa tus tres tareas. El borde amarillo marca dónde estás. La barra de arriba es el avance de toda la tripulación.
4. **Impostor:** finge que trabajas, usa las ventilas (borde punteado) y elimina a quien esté en tu misma sala. Después de un ataque hay que esperar 3 acciones.
5. Si hay un cuerpo en tu sala, pulsa **Reportar cuerpo**. **Emergencia** convoca una reunión y solo se puede usar una vez.
6. En la reunión hablen y voten. Sale quien tenga más votos. Si hay empate, o gana **Saltar**, no expulsan a nadie.
7. Ganan los tripulantes si echan a todos los impostores o si terminan todas las tareas. Gana el impostor si quedan tantos impostores vivos como tripulantes vivos.
8. **Nueva partida** reinicia la sala para todo el mundo.

Los fantasmas pueden moverse y, si eran tripulantes, seguir con sus tareas. No votan.
