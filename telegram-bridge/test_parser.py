import unittest
from parser import parse_message

class ParserTests(unittest.TestCase):
    def test_drone_destination(self):
        x = parse_message("3х БПЛА курсом на Васильків")
        self.assertEqual(x.type, "drone")
        self.assertEqual(x.count, 3)
        self.assertEqual(x.location, "Васильків")

    def test_missile_direction(self):
        x = parse_message("Ракета у напрямку на Київ, курс північно-західний")
        self.assertEqual(x.type, "missile")
        self.assertEqual(x.location, "Київ")
        self.assertEqual(x.course, 315)

    def test_near_place(self):
        x = parse_message("Шахед поблизу Білої Церкви")
        self.assertEqual(x.type, "drone")
        self.assertEqual(x.location, "Білої Церкви")

    def test_ignore_general_text(self):
        self.assertIsNone(parse_message("У Києві сьогодні хмарно"))

if __name__ == '__main__':
    unittest.main()
