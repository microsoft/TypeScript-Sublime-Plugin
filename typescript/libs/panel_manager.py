import sublime
from .global_vars import IS_ST2, PLUGIN_NAME

class PanelManager:

    def __init__(self):
        self.panels = dict()
        self.panel_line_maps = dict()

    def get_panel(self, panel_name):
        if panel_name not in self.panels:
            self.add_panel(panel_name)
        return self.panels[panel_name]

    def set_line_map(self, panel_name, map):
        if panel_name in self.panels:
            self.panel_line_maps[panel_name] = map

    def get_line_map(self, panel_name):
        if panel_name in self.panel_line_maps:
            return self.panel_line_maps[panel_name]

    def add_panel(self, panel_name):
        if panel_name not in self.panels:
            if IS_ST2:
                self.panels[panel_name] = sublime.active_window().get_output_panel(panel_name)
            else:
                self.panels[panel_name] = sublime.active_window().create_output_panel(panel_name)
        settings = self.panels[panel_name].settings()
        settings.set("auto_indent", False)
        settings.set("draw_white_space", "none")
        settings.set("line_numbers", False)
        if panel_name == "errorlist":
            self.panels[panel_name].set_syntax_file("Packages/" + PLUGIN_NAME + "/ErrorList.hidden-tmLanguage")
        else:
            self.panels[panel_name].set_syntax_file("Packages/Text/Plain Text.tmLanguage")

    def is_panel_active(self, panel_name):
        return panel_name in self.panels and self.panels[panel_name].window() is not None

    def show_panel(self, panel_name, initial_content_lines=None):
        if initial_content_lines is not None:
            self.write_lines_to_panel(panel_name, initial_content_lines)
        sublime.active_window().run_command("show_panel", {"panel": "output." + panel_name})

    def write_lines_to_panel(self, panel_name, lines):
        # check if actual changes happen to unncessasary refreshing
        # which cound be annoying if the user chose to fold some text 
        # and it gets unfolded every time the panel refreshes
        panel = self.panels[panel_name]
        original_countent = panel.substr(sublime.Region(0, panel.size()))
        new_countent = "\n".join(lines)
        if original_countent != new_countent:
            panel.set_read_only(False)
            panel.run_command("select_all")
            panel.run_command("right_delete")
            panel.run_command("insert", {"characters": new_countent})
            self.panels[panel_name].set_read_only(True)

    def hide_panel(self):
        sublime.active_window().run_command("hide_panel")

_panel_manager = None

def get_panel_manager():
    global _panel_manager
    if _panel_manager is None:
        _panel_manager = PanelManager()
    return _panel_manager