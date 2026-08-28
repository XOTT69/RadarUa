import unittest
from parser import parse_message

class ParserTests(unittest.TestCase):
    def one(self, text):
        items = parse_message(text)
        self.assertGreaterEqual(len(items), 1)
        return items[0]

    def test_drone_destination(self):
        p = self.one("3х БПЛА курсом на Васильків")
        self.assertEqual(p.type, "drone")
        self.assertEqual(p.count, 3)
        self.assertEqual(p.location, "Васильків")
        self.assertEqual(p.location_role, "destination")

    def test_missile(self):
        p = self.one("Ракета у напрямку на Київ, швидкісна ціль")
        self.assertEqual(p.type, "missile")
        self.assertEqual(p.location, "Київ")

    def test_kab(self):
        p = self.one("Пуски КАБ у напрямку Сум")
        self.assertEqual(p.type, "kab")
        self.assertEqual(p.location, "Сум")

    def test_near(self):
        p = self.one("Шахед поблизу Броварів, рух на захід")
        self.assertEqual(p.type, "drone")
        self.assertEqual(p.location, "Броварів")
        self.assertEqual(p.location_role, "near")
        self.assertEqual(p.course, 270)

    def test_global_event_is_kept(self):
        p = self.one("У повітрі Ту-95МС. Стежимо.")
        self.assertEqual(p.type, "aviation")
        self.assertIsNone(p.location)

    def test_explosion(self):
        p = self.one("Вибухи у районі Харкова")
        self.assertEqual(p.type, "explosion")
        self.assertEqual(p.location, "Харкова")

    def test_clear(self):
        p = self.one("Відбій загрози БПЛА у районі Чабанів")
        self.assertEqual(p.type, "clear")
        self.assertEqual(p.location, "Чабанів")

    def test_multiple_locations(self):
        items = parse_message("БПЛА у напрямку Бровари та Бориспіль")
        self.assertEqual([x.location for x in items], ["Бровари", "Бориспіль"])

    def test_noise_not_event(self):
        self.assertEqual(parse_message("Доброго ранку, друзі"), [])

if __name__ == '__main__':
    unittest.main()

class RealFormatTests(unittest.TestCase):
    def test_inherited_course(self):
        p = parse_message("Курсом на Васильків.", inherited_type="drone")[0]
        self.assertEqual(p.type, "drone")
        self.assertEqual(p.location, "Васильків")

    def test_attention_prefix_with_context(self):
        p = parse_message("Жуляни — уважно!", inherited_type="drone")[0]
        self.assertEqual(p.location, "Жуляни")

    def test_kpszsu_city_prefix(self):
        p = parse_message("БпЛА в напрямку м.Запоріжжя зі сходу.")[0]
        self.assertEqual(p.location, "Запоріжжя")

    def test_direct_on_city(self):
        p = parse_message("Реактивний БпЛА на Бровари.")[0]
        self.assertEqual(p.location, "Бровари")
