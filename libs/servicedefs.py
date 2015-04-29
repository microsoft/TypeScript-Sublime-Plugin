class Location:
    def __init__(self, line, offset):
        """
        Object containing line and offset (one-based) of file location
        """
        self.line = line
        self.offset = offset

    def toDict(self):
        return { "line": self.line, "offset": self.offset }

