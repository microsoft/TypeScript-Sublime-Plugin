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

    def is_panel_active(self, panel_name):
        return panel_name in self.panels and self.panels[panel_name].window() is not None

    def show_panel(self, panel_name):
        sublime.active_window().run_command("show_panel", {"panel": "output." + panel_name})

    def hide_panel(self):
        sublime.active_window().run_command("hide_panel")

_panel_manager = None

def get_panel_manager():
    global _panel_manager
    if _panel_manager is None:
        _panel_manager = PanelManager()
    return _panel_manager