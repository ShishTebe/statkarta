-- Печать файла .docx в PDF нативным Microsoft Word (Фаза 1.6, шаг разметки бланка).
-- Запуск: osascript scripts/blanks/topdf.applescript <входной .docx> <выходной .pdf>
--
-- Скрипт работает только со своим файлом: документ узнается по имени открываемого файла, чужие
-- документы не закрываются и не сохраняются, Word не запускается заново и не завершается.
-- Свой документ закрывается в любом случае, в том числе при ошибке: иначе неудачные попытки
-- накапливаются в Word и мешают и следующим запускам, и работе пользователя.
on closeMine(n)
	tell application "Microsoft Word"
		repeat with i from (count of documents) to 1 by -1
			try
				if name of document i is n then close document i saving no
			end try
		end repeat
	end tell
end closeMine

on run argv
	set srcPath to item 1 of argv
	set dst to item 2 of argv
	set srcName to do shell script "basename " & quoted form of srcPath
	my closeMine(srcName)
	set failure to ""
	tell application "Microsoft Word"
		with timeout of 900 seconds
			try
				open (POSIX file srcPath)
			end try
			set theDoc to missing value
			repeat 120 times
				delay 1
				try
					set d to active document
					if d is not missing value and name of d is srcName then
						set theDoc to d
						exit repeat
					end if
				end try
			end repeat
			if theDoc is missing value then
				set failure to "Word не открыл файл " & srcName
			else
				try
					save as theDoc file format format PDF file name dst
				on error e
					set failure to "Word не напечатал PDF: " & e
				end try
			end if
		end timeout
	end tell
	my closeMine(srcName)
	if failure is not "" then error failure
	return dst
end run
