class_name note_button
extends Button

var note_content: String = "默认内容"

func setup (pos:Vector2,content:String)->void:
	position = pos
	note_content = content#！！！！！！！！！这里需要修改


func _on_button_down() -> void:
	pass # Replace with function body.
