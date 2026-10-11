import unittest

from app.check_schema import check_schema


class SchemaContractTests(unittest.TestCase):
    def test_migration_contract(self):
        check_schema()


if __name__ == "__main__":
    unittest.main()
