# Генератор git історії для законів України

Ідея даного репозиторію не нова і полягає в використанні Git для відстежування змін в законодавчих та інших правових документах України.
Html документи перетворюються в формат Markdown для покращення можливості перегляду безпосереднього тексту документів, а також збереження посилань та базового форматування.

# Приблизний алгоритм генератора
1. Для обраного документа, завантажити список його попередніх версій, а також поточну з сайта [zakon.rada.gov.ua](https://zakon.rada.gov.ua/);
2. Для кожної версії:
	1. Завантажити `html` текст документа;
	2. Перетворити його в `markdown` за допомогою бібліотеки [turndown](https://github.com/mixmark-io/turndown);
	3. Оновити текст відповідного документа;
	4. Підготувати git повідомлення у форматі:
	```
	Додає/Оновлює "Назва документа" (код, редакція, підстава зміни)

	Джерело: посилання на джерело
	```
	5. Створити коміт (в інтерактивному режимі або без людського втручання)
3. Надати також можливість вказати з якої версії документа починати роботу (для подальшого оновлення документа, коли вже частина версій вже була додана).

# Приклад створеної git історії
* [ukrainian-laws-in-time](https://github.com/skivol/ukrainian-laws-in-time)

# Версія Node JS
v17.4.0

# Рекомендоване налаштування Git
* Для відображення українських слів в назвах файлів: `git config --global core.quotePath false` [джерело](https://stackoverflow.com/a/34549249)
* Версія 2.30+ (спосіб фільтрувати незначні зміни (наприклад, посилання) - [stackoverflow](https://stackoverflow.com/a/64758633))
* Завжди використовувати "pager" (наприклад, для "delta", - `git config --global core.pager 'delta --paging always'`):

# Налаштування delta
Варто звернути увагу на `max-line-length` та `wrap-max-lines`, наприклад:
```
[delta]
    features = side-by-side line-numbers decorations
    whitespace-error-style = 22 reverse
    max-line-length = 0
    wrap-max-lines = unlimited
```

# Залежності
## Бібліотеки
1. node-fetch
## Програми
1. [pandoc](https://pandoc.org/) - для перетворення html в pandoc markdown.

# Корисні інструменти
1. Перегляд markdown документів з командного рядка - https://github.com/charmbracelet/glow
2. Перегляд змін у документах - https://github.com/dandavison/delta

# TODO
* e2e тести

# Інші назви
Генератор для Законов Украины во времени; Ukrainian Laws in Time Generator

# Ліцензія
[![Ліцензія Creative Commons](https://i.creativecommons.org/l/by/4.0/88x31.png)](http://creativecommons.org/licenses/by/4.0/)  
Цей твір ліцензовано на умовах [Ліцензії Creative Commons Зазначення Авторства 4.0 Міжнародна](http://creativecommons.org/licenses/by/4.0/).

