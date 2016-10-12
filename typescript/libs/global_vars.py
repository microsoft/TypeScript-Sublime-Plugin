import os
import re
import logging
import sublime
from os.path import dirname

# determine if the host is sublime text 2
IS_ST2 = int(sublime.version()) < 3000

# Get the directory path to this file;
# Note: there are several ways this plugin can be installed
# 1. from the package control -> the absolute path of __file__ is real and contains plugin name
# 2. git clone directly to the sublime packages folder -> the absolute path of __file__ is real and contains plugin name
# 3. git clone to somewhere else, and link to the sublime packages folder -> the absolute path is real in Sublime 3,
# but is somewhere else in Sublime 2;and therefore in Sublime 2 there is no direct way to obtain the plugin name
if not IS_ST2:
    PLUGIN_DIR = dirname(dirname(dirname(os.path.abspath(__file__))))
else:
    _sublime_packages_dir = sublime.packages_path()
    _cur_file_abspath = os.path.abspath(__file__)
    if _sublime_packages_dir not in _cur_file_abspath:
        # The plugin is installed as a link
        for p in os.listdir(_sublime_packages_dir):
            link_path = _sublime_packages_dir + os.sep + p
            if os.path.realpath(link_path) in _cur_file_abspath:
                PLUGIN_DIR = link_path
                break
    else:
        PLUGIN_DIR = dirname(dirname(dirname(os.path.abspath(__file__))))
PLUGIN_NAME = os.path.basename(PLUGIN_DIR)

# The node path will be initialized in the node_client.py module
_node_path = None
def get_node_path():
    return _node_path

# The tsc.js path will be initialized in the editor_client.py module
_tsc_path = None
def get_tsc_path():
    return _tsc_path

# only Sublime Text 3 build after 3072 support tooltip
TOOLTIP_SUPPORT = int(sublime.version()) >= 3072

PHANTOM_SUPPORT = int(sublime.version()) >= 3118

# detect if quick info is available for symbol
SUBLIME_WORD_MASK = 515

# set logging levels
LOG_FILE_LEVEL = logging.WARN
LOG_CONSOLE_LEVEL = logging.WARN

NON_BLANK_LINE_PATTERN = re.compile("[\S]+")
VALID_COMPLETION_ID_PATTERN = re.compile("[a-zA-Z_$\.][\w$\.]*\Z")

# idle time length in millisecond
IDLE_TIME_LENGTH = 200

_language_service_enabled = True
def get_language_service_enabled():
        return _language_service_enabled