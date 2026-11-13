# session-monitor

Panel lateral para Claude Code que muestra el porcentaje de cuota consumida (ventanas de 5 horas y semanal), el modelo en uso con su nivel de esfuerzo, si hay subagentes en ejecución, y el uso de la ventana de contexto con un botón para compactar el contexto. Se abre solo al iniciar la sesión; `/monitor` lo vuelve a abrir.

## Instalación

En el prompt de una sesión de Claude Code en la terminal:

```
/plugin install session-monitor --marketplace Thomi33/claude-session-monitor
```

Respondé `y` para agregar el marketplace y elegí el alcance (scope) con Enter.

Desde una shell:

```
claude plugin install session-monitor --marketplace Thomi33/claude-session-monitor
```

En la app de escritorio: hacé clic en + junto al cuadro del prompt, luego Plugins, Add marketplace con `Thomi33/claude-session-monitor`, y después Add plugin.
