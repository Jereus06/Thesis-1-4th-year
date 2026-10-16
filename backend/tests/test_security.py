import unittest

from app.security import hash_password, token_hash, verify_password


class SecurityTests(unittest.TestCase):
    def test_password_hash_is_salted_and_verifiable(self):
        first = hash_password("correct horse battery staple")
        second = hash_password("correct horse battery staple")
        self.assertNotEqual(first, second)
        self.assertTrue(verify_password("correct horse battery staple", first))
        self.assertFalse(verify_password("wrong password", first))

    def test_session_token_hash_is_not_plaintext(self):
        self.assertEqual(len(token_hash("secret-session")), 64)
        self.assertNotIn("secret-session", token_hash("secret-session"))


if __name__ == "__main__":
    unittest.main()
