import sublime

class PanelManager:

    def __init__(self):
        self.panels = dict()

    def get_panel(self, panel_name):
        if panel_name not in self.panels:
            self.panels[panel_name] = sublime.active_window().create_output_panel(panel_name)
        return self.panels[panel_name]

    def add_panel(self, panel_name):
        if panel_name not in self.panels:
            self.panels[panel_name] = sublime.active_window().create_output_panel(panel_name)
        self.panels[panel_name].set_read_only(True)
        self.panels[panel_name].settings().set("auto_indent", False)
        self.panels[panel_name].settings().set("draw_white_space", "none")

    def is_panel_active(self, panel_name):
        return panel_name in self.panels and self.panels[panel_name].window() is not None

    def show_panel(self, panel_name):
        sublime.active_window().run_command("show_panel", {"panel": "output." + panel_name})

    def write_lines_to_panel(self, panel_name, lines):
        panel = self.panels[panel_name]
        panel.set_read_only(False)
        panel.run_command("select_all")
        panel.run_command("right_delete")
        panel.run_command("insert", {"characters": "\n".join(lines)})
        self.panels[panel_name].set_read_only(True)

    def hide_panel(self):
        sublime.active_window().run_command("hide_panel")

_panel_manager = None

def get_panel_manager():
    global _panel_manager
    if _panel_manager is None:
        _panel_manager = PanelManager()
    return _panel_manager