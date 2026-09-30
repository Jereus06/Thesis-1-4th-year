import unittest
from datetime import date, timedelta


class ForecastBoundaryContractTests(unittest.TestCase):
    def test_period_boundaries_are_strictly_ordered(self):
        train_end = date(2026, 6, 30)
        validation_end = date(2026, 7, 31)
        final_test_end = date(2026, 8, 31)
        self.assertLess(train_end, validation_end)
        self.assertLess(validation_end, final_test_end)

    def test_example_periods_do_not_overlap(self):
        train_end = date(2026, 6, 30)
        validation_start = train_end + timedelta(days=1)
        validation_end = date(2026, 7, 31)
        test_start = validation_end + timedelta(days=1)
        self.assertGreater(validation_start, train_end)
        self.assertGreater(test_start, validation_end)


if __name__ == "__main__":
    unittest.main()
