-- Печать книги .xlsx в PDF нативным Microsoft Excel (Фаза 1.6, сверка ф. 3).
-- Запуск: osascript scripts/blanks/xlsx_topdf.applescript <вход.xlsx> <выход.pdf>
on run argv
	set src to item 1 of argv
	set dst to item 2 of argv
	set n to do shell script "basename " & quoted form of src
	tell application "Microsoft Excel"
		with timeout of 600 seconds
			open (POSIX file src)
			set wb to missing value
			repeat 60 times
				delay 1
				try
					set wb to workbook n
					exit repeat
				end try
			end repeat
			if wb is missing value then error "Excel не открыл " & n
			save workbook as wb filename dst file format PDF file format
			close wb saving no
		end timeout
	end tell
	return dst
end run
