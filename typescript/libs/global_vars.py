import os
import re
import logging
import sublime
from os.path import dirname


# Get the directory path to this file;
# Note: MODULE_DIR, PLUGIN_DIR and PLUGIN_NAME only works correctly when:
# 1. Using sublime 3
# 2. Using sublime 2, and the plugin folder is not a symbol link
# On sublime 2 with the plugin folder being a symbol link, the PLUGIN_FOLDER will points
# to the linked real path instead, and the PLUGIN_NAME will be wrong too.
MODULE_DIR = dirname(dirname(os.path.abspath(__file__)))
PLUGIN_DIR = dirname(MODULE_DIR)
PLUGIN_NAME = os.path.basename(PLUGIN_DIR)

# only Sublime Text 3 build after 3072 support tooltip
TOOLTIP_SUPPORT = int(sublime.version()) >= 3072

# determine if the host is sublime text 2
IS_ST2 = int(sublime.version()) < 3000

# detect if quick info is available for symbol
SUBLIME_WORD_MASK = 515

# set logging levels
LOG_FILE_LEVEL = logging.WARN
LOG_CONSOLE_LEVEL = logging.WARN

NON_BLANK_LINE_PATTERN = re.compile("[\S]+")
VALID_COMPLETION_ID_PATTERN = re.compile("[a-zA-Z_$\.][\w$\.]*\Z")

# idle time length in millisecond
IDLE_TIME_LENGTH = 200
