"""
Exposes logging and debugging operations.

Use the 'debug', 'info', 'warning', 'error', or 'critial' methods on the 'log'
object to send messages to the stderr (which appear in the console in Sublime).

A log file is also created in the plugin folder for messages at the level set
by the properties below.
"""

import logging
from os import path

# The default path to the log file created for diagnostic output
_pluginRoot = path.dirname(path.dirname(path.abspath(__file__)))
filePath = path.join(_pluginRoot, 'TS.log')

log = logging.getLogger('TS')
log.setLevel(logging.DEBUG)

_logFormat = logging.Formatter('%(asctime)s: %(thread)d: %(levelname)s: %(message)s')

logFile = logging.FileHandler(filePath, mode='w')
logFile.setLevel(logging.DEBUG)
logFile.setFormatter(_logFormat)
log.addHandler(logFile)

console = logging.StreamHandler()
console.setLevel(logging.INFO)
console.setFormatter(_logFormat)
log.addHandler(console)

log.info('Logging configured to log to file: {0}'.format(filePath))

def view_debug(view, message):
    fileName = view.file_name()
    viewName = view.name()
    name = viewName if fileName == None else fileName
    log.debug(message + ": " + name)
