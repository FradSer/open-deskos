Feature: Bounded safe user-app file operations
  Scenario: Read a regular file within a trusted root
    Given a regular file below the root
    When it is read with a byte limit
    Then the exact bytes are returned

  Scenario: Refuse traversal, symlinks, non-regular files and growth
    Given files with unsafe path components or more bytes than allowed
    When a file operation is requested
    Then it fails without accessing outside the root

  Scenario: Create private directories and exclusive files
    Given a root directory
    When a nested directory and new file are created
    Then directories are mode 0700 and files are mode 0600
    When the destination already exists
    Then exclusive writing fails
