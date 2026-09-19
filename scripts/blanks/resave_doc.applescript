-- Однократная нормализация бланка нативным Word: .docx → .doc (Word 97–2003) → .docx.
-- Нужна для бланков в записи DrawingML (ф. 2.1): Word раскладывает текст в группах таких фигур
-- не по их порядку, а после пересохранения фигуры записываются в VML, как в остальных бланках.
-- Запуск: osascript scripts/blanks/resave_doc.applescript <вход.docx> <промежуточный.doc> <выход.docx>
on findDoc(n)
	tell application "Microsoft Word"
		repeat with i from 1 to (count of documents)
			try
				if name of document i is n then return document i
			end try
		end repeat
	end tell
	return missing value
end findDoc

on openAndWait(p)
	set n to do shell script "basename " & quoted form of p
	tell application "Microsoft Word" to open (POSIX file p)
	repeat 120 times
		set d to my findDoc(n)
		if d is not missing value then return d
		delay 1
	end repeat
	error "Word не открыл файл " & n
end openAndWait

on run argv
	set src to item 1 of argv
	set mid to item 2 of argv
	set dst to item 3 of argv
	set d to my openAndWait(src)
	tell application "Microsoft Word"
		save as d file name mid file format format document97
		close d saving no
	end tell
	set d2 to my openAndWait(mid)
	tell application "Microsoft Word"
		save as d2 file name dst file format format document
		close d2 saving no
	end tell
	return dst
end run
