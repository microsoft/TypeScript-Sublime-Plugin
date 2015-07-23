from .reference import RefInfo
from .node_client import ServerClient, WorkerClient
from .service_proxy import ServiceProxy
from .global_vars import *


class ClientFileInfo:
    """per-file, globally-accessible information"""

    def __init__(self, filename):
        self.filename = filename
        self.pending_changes = False
        self.change_count = 0
        self.errors = {
            'syntacticDiag': [],
            'semanticDiag': [],
        }
        self.rename_on_load = None


class EditorClient:
    """A singleton class holding information for the entire application that must be accessible globally"""

    _FORMATTING_SETTINGS = [
        # (setting_name, default_setting_value, class_property_name)
        ('tab_size',                    4,      'tab_size'),
        ('indent_size',                 4,      'indent_size'),
        ('translate_tabs_to_spaces',    False,  'translate_tabs_to_spaces'),
        ('typescript_auto_format',      True,   'ts_auto_format_enabled'),
        ('typescript_auto_indent',      True,   'ts_auto_indent_enabled'),
        ('auto_match_enabled',          True,   'auto_match_enabled'),
    ]

    def __init__(self):
        self.file_map = {}
        self.ref_info = None
        self.seq_to_tempfile_name = {}
        self.available_tempfile_list = []
        self.tmpseq = 0
        self.node_client = None
        self.worker_client = None
        self.service = None
        self.initialized = False

    def initialize(self):
        """
        Sublime_api methods can only be executed in plugin_loaded, and they will
        return None if executed during import time. Therefore the cli needs to be
        initialized during loading time
        """

        # retrieve the path to tsserver.js
        # first see if user set the path to the file
        settings = sublime.load_settings('Preferences.sublime-settings')
        proc_file = settings.get('typescript_proc_file')
        if not proc_file:
            # otherwise, get tsserver.js from package directory
            proc_file = os.path.join(PLUGIN_DIR, "tsserver", "tsserver.js")
        print("spawning node module: " + proc_file)

        self.node_client = ServerClient(proc_file)
        self.worker_client = WorkerClient(proc_file)
        self.service = ServiceProxy(self.worker_client, self.node_client)

        # load formatting settings and set callbacks for setting changes
        self._set_formatting_settings_callbacks()
        self._load_formatting_settings()

        self.initialized = True

    def _set_formatting_settings_callbacks(self):
        syntax_settings = sublime.load_settings('TypeScript.sublime-settings')
        preference_settings = sublime.load_settings('Preferences.sublime-settings')

        for (setting_name, _, _) in EditorClient._FORMATTING_SETTINGS:
            syntax_settings.add_on_change(setting_name,
                                          self._load_formatting_settings)
            preference_settings.add_on_change(setting_name,
                                              self._load_formatting_settings)

    def _load_formatting_settings(self):
        syntax_settings = sublime.load_settings('TypeScript.sublime-settings')
        preference_settings = sublime.load_settings('Preferences.sublime-settings')

        for (setting_name, default_value, property_name) in EditorClient._FORMATTING_SETTINGS:
            # Sublime Text prioritizes syntax settings over preference
            # settings. We follow this order here.
            value = syntax_settings.get(setting_name,
                preference_settings.get(setting_name, default_value))
            setattr(self, property_name, value)

        self._set_features()

    def _set_features(self):
        host_info = "Sublime Text version " + str(sublime.version())
        # Preferences Settings
        format_options = {
            "tabSize": self.tab_size,
            "indentSize": self.indent_size,
            "convertTabsToSpaces": self.translate_tabs_to_spaces
        }
        self.service.configure(host_info, None, format_options)

    # ref info is for Find References view
    # TODO: generalize this so that there can be multiple
    # for example, one for Find References and one for build errors
    def dispose_ref_info(self):
        self.ref_info = None

    def init_ref_info(self, first_line, ref_id):
        self.ref_info = RefInfo(first_line, ref_id)
        return self.ref_info

    def update_ref_info(self, ref_info):
        self.ref_info = ref_info

    def get_ref_info(self):
        return self.ref_info

    def get_or_add_file(self, filename):
        """Get or add per-file information that must be globally accessible """
        if os.name == "nt" and filename:
            filename = filename.replace('/', '\\')
        if filename not in self.file_map:
            client_info = ClientFileInfo(filename)
            self.file_map[filename] = client_info
        else:
            client_info = self.file_map[filename]
        return client_info

    def has_errors(self, filename):
        client_info = self.get_or_add_file(filename)
        return (len(client_info.errors['syntacticDiag']) > 0 or
                len(client_info.errors['semanticDiag']) > 0)

# The globally accessible instance
cli = EditorClient()