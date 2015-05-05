import sublime, sublime_plugin

class Location:
    """Object containing line and offset (one-based) of file location"""
    def __init__(self, line, offset):
        self.line = line
        self.offset = offset

    def toDict(self):
        return { "line": self.line, "offset": self.offset }

